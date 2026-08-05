#!/usr/bin/env node
// CLI over the run-state ratchet (specs/agent/agent-stage-3-state-ratchet.md).
//
//   pnpm agent:ratchet <command> [args]
//
// Commands (agents use these; the outer loop uses these):
//   init --stage <id> --units <file.json>     create .agent/units.json
//   status [--json]                           every unit and its state
//   next [--json]                             next eligible unit + what to do about it
//   set-status <unit> <status> [--sha S] [--reason R]
//   record-role <unit> <role> --outcome O [--note N] [--transcript P]
//   bounce <unit> --reason R                  send work back (increments bounce_count)
//   learn --unit U --kind K --evidence E --action A [--role R] [--rule D-NN] [--loose]
//   failed --unit U --approach A --why W --do-not-retry D [--role R]
//   event --kind K [--unit U] [--extra JSON]  append to run-log.jsonl
//   validate [--loose]                        check every file; exit 4 if anything is wrong
//
// Exit codes: 0 ok, 1 usage/runtime error, 4 validation failure, 5 ratchet violation.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  LEARNING_KINDS,
  RatchetError,
  appendFailedApproach,
  appendLearning,
  appendRunEvent,
  initUnits,
  latestRun,
  learningsCoverage,
  loadUnits,
  nextAction,
  nextEligibleUnit,
  ratchetViolations,
  readLearnings,
  recordRole,
  setStatus,
  unitById,
  validateLearning,
} from './state.mjs';
import { argvReader, repoRoot } from './cli.mjs';

const argv = process.argv.slice(2);
const command = argv[0];

const { flag, has } = argvReader(argv);

const root = repoRoot();
const positional = argv
  .slice(1)
  .filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function describeAction(action) {
  switch (action.kind) {
    case 'spawn':
      return `SPAWN ${action.role} for ${action.unit} — ${action.why}`;
    case 'resume':
      return `RESUME ${action.role} for ${action.unit} — ${action.why}. Do NOT spawn a replacement.`;
    case 'commit':
      return `COMMIT ${action.unit} — all three roles are green`;
    case 'blocked':
      return `BLOCKED ${action.unit} — ${action.reason ?? 'no reason recorded'}`;
    case 'done':
      return `DONE ${action.unit}`;
    default:
      return JSON.stringify(action);
  }
}

try {
  switch (command) {
    case 'init': {
      const stage = flag('stage');
      const unitsFile = flag('units');
      if (!stage || !unitsFile) die('usage: init --stage <id> --units <file.json>');
      const units = JSON.parse(readFileSync(unitsFile, 'utf8'));
      const data = initUnits(root, { stage, units: Array.isArray(units) ? units : units.units });
      console.log(`initialised ${data.units.length} unit(s) for stage ${stage}`);
      break;
    }

    case 'status': {
      const data = loadUnits(root);
      if (has('json')) {
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      console.log(`stage: ${data.stage}`);
      for (const u of data.units) {
        const roles = Object.entries(u.roles_run ?? {})
          .map(([role, runs]) => `${role}=${runs[runs.length - 1].outcome}(${runs.length})`)
          .join(' ');
        const sha = u.committed_sha ? ` sha=${u.committed_sha.slice(0, 8)}` : '';
        const bounces = u.bounce_count ? ` bounces=${u.bounce_count}` : '';
        console.log(`  ${u.id}  [${u.status}]${sha}${bounces}  ${u.title}`);
        if (roles) console.log(`      runs: ${roles}`);
        if (u.blocked_reason) console.log(`      blocked: ${u.blocked_reason}`);
      }
      break;
    }

    case 'next': {
      const data = loadUnits(root);
      const unit = nextEligibleUnit(data);
      if (!unit) {
        const blocked = data.units.filter((u) => u.status === 'blocked');
        const payload = { kind: 'none', blocked: blocked.map((u) => u.id) };
        console.log(has('json') ? JSON.stringify(payload) : 'NONE — no eligible unit remains');
        process.exit(blocked.length ? 6 : 0);
      }
      const action = { ...nextAction(unit), title: unit.title, spec_ref: unit.spec_ref };
      console.log(has('json') ? JSON.stringify(action) : describeAction(action));
      break;
    }

    case 'set-status': {
      const [unit, status] = positional;
      if (!unit || !status) die('usage: set-status <unit> <status> [--sha S] [--reason R]');
      setStatus(root, unit, status, { sha: flag('sha'), reason: flag('reason') });
      console.log(`${unit} → ${status}`);
      break;
    }

    case 'record-role': {
      const [unit, role] = positional;
      const outcome = flag('outcome');
      if (!unit || !role || !outcome) {
        die('usage: record-role <unit> <role> --outcome O [--note N] [--transcript P]');
      }
      recordRole(root, unit, role, {
        outcome,
        note: flag('note', ''),
        transcript: flag('transcript'),
      });
      console.log(`${unit}: recorded ${role} = ${outcome}`);
      break;
    }

    case 'bounce': {
      const [unit] = positional;
      const reason = flag('reason');
      if (!unit || !reason) die('usage: bounce <unit> --reason R');
      setStatus(root, unit, 'bounced', { reason });
      const data = loadUnits(root);
      console.log(`${unit} bounced (count=${unitById(data, unit).bounce_count})`);
      break;
    }

    case 'learn': {
      const entry = {
        unit: flag('unit'),
        role: flag('role', 'orchestrator'),
        kind: flag('kind'),
        evidence: flag('evidence'),
        action: flag('action'),
      };
      // Only doctrine entries carry one, and for those it is mandatory (FR-A5.2).
      if (flag('rule')) entry.rule = flag('rule');
      if (!entry.kind || !LEARNING_KINDS.includes(entry.kind)) {
        die(`--kind must be one of: ${LEARNING_KINDS.join(', ')}`);
      }
      appendLearning(root, entry, { strict: !has('loose') });
      console.log(`recorded ${entry.kind} learning for ${entry.unit}`);
      break;
    }

    case 'failed': {
      appendFailedApproach(root, {
        unit: flag('unit'),
        role: flag('role'),
        approach: flag('approach'),
        why: flag('why'),
        doNotRetry: flag('do-not-retry'),
      });
      console.log(`recorded failed approach for ${flag('unit')}`);
      break;
    }

    case 'event': {
      const kind = flag('kind');
      if (!kind) die('usage: event --kind K [--unit U] [--extra JSON]');
      const extra = flag('extra');
      appendRunEvent(root, {
        kind,
        unit: flag('unit'),
        ...(extra ? JSON.parse(extra) : {}),
      });
      break;
    }

    // The whole-file audit. Everything AC-A3.5/AC-A3.6 assert, in one command
    // the loop and CI can both run.
    case 'validate': {
      const strict = !has('loose');
      const problems = [];
      const data = loadUnits(root);

      // Units integrity, including the git-verified terminal state.
      for (const u of data.units) {
        if (u.status === 'committed' && !u.committed_sha) {
          problems.push(`${u.id}: committed with no sha`);
        }
        if (u.committed_sha) {
          try {
            execFileSync('git', ['-C', root, 'cat-file', '-e', `${u.committed_sha}^{commit}`], {
              stdio: 'ignore',
            });
          } catch {
            problems.push(`${u.id}: committed_sha ${u.committed_sha} is not a commit in this repo`);
          }
        }
        for (const dep of u.depends_on ?? []) {
          if (!data.units.some((o) => o.id === dep))
            problems.push(`${u.id}: unknown dependency \`${dep}\``);
        }
      }

      // Committed history check: compare against the last committed version of
      // the units file, which is what makes the ratchet auditable after the fact.
      try {
        const previous = execFileSync('git', ['-C', root, 'show', 'HEAD:.agent/units.json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        problems.push(...ratchetViolations(JSON.parse(previous), data));
      } catch {
        // No committed predecessor yet — nothing to ratchet against.
      }

      // Learnings: parseable, non-vacuous, and two-sided per unit.
      const learnings = readLearnings(root);
      learnings.forEach((entry, i) => {
        if (entry.__parseError) {
          problems.push(`learnings.jsonl:${entry.line}: not valid JSON`);
          return;
        }
        const errs = validateLearning(entry, { strict });
        for (const err of errs)
          problems.push(`learnings.jsonl entry ${i + 1} (${entry.unit}): ${err}`);
      });

      const coverage = learningsCoverage(root);
      for (const u of data.units) {
        if (u.status !== 'committed') continue;
        const seen = coverage.get(u.id) ?? { strength: 0, weakness: 0 };
        if (!seen.strength || !seen.weakness) {
          problems.push(
            `${u.id}: learnings are one-sided (strength=${seen.strength} weakness=${seen.weakness}) — ` +
              `a committed unit records both what worked and what did not`,
          );
        }
      }

      if (problems.length) {
        console.error(`FAIL (${problems.length})`);
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(4);
      }
      console.log(`OK — ${data.units.length} unit(s), ${learnings.length} learning(s)`);
      break;
    }

    // Field accessor for the bash outer loop, so it never parses JSON itself.
    case 'unit-field': {
      const [unitId, field] = positional;
      const unit = unitById(loadUnits(root), unitId);
      const value = unit[field];
      console.log(value === null || value === undefined ? '' : String(value));
      break;
    }

    // Exit 0 only if this unit recorded both sides of the story (FR-A4.2's exit
    // gate). The loop branches on the exit code.
    case 'learnings-ok': {
      const [unitId] = positional;
      const seen = learningsCoverage(root).get(unitId) ?? { strength: 0, weakness: 0 };
      console.log(`strength=${seen.strength} weakness=${seen.weakness}`);
      process.exit(seen.strength > 0 && seen.weakness > 0 ? 0 : 7);
      break;
    }

    // Used by the bootstrap script: has this role already run for this unit?
    case 'role-state': {
      const [unitId, role] = positional;
      const unit = unitById(loadUnits(root), unitId);
      const run = latestRun(unit, role);
      console.log(JSON.stringify(run ?? { outcome: 'never-ran' }));
      break;
    }

    default:
      die(
        'commands: init status next set-status record-role bounce learn failed event validate ' +
          'role-state unit-field learnings-ok',
      );
  }
} catch (err) {
  if (err instanceof RatchetError) die(err.message, 5);
  die(`${err.message}`, 1);
}
