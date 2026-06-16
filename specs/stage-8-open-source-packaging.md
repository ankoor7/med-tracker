# Stage 8 Spec — Open-Source Packaging & Deploy

| | |
|---|---|
| **Depends on** | Stages 3, 4, 5 (and 1) |
| **Implements** | FR-OSS-2..5; bring-your-own-AWS release |
| **Milestone** | D |
| **Status** | Ready after the cloud track |

## 1. Objective
Make SteadyDose a clean **open-source project that any technical user can deploy to their own AWS account** with one command, configure their own medications, and **plug in their own pharmacology equations**. Provide complete docs, security guidance, and a swappable extension.

## 2. Scope
**In:** one-command deploy + generated config; setup/teardown docs; LICENSE + contributing/security policy; secrets guidance; documented pharmacology extension guide + example; first-run onboarding (passphrase + recovery code); minimal release hardening.
**Out:** hosted multi-tenant offering; app-store distribution (PWA install only).

## 3. Prerequisites
Deployable backend (Stage 3), encryption (Stage 4), sync (Stage 5).

## 4. Functional requirements
- FR-8.1. A documented **one-command deploy** path (wrapper script over `cdk bootstrap`/`deploy` + asset upload + invalidation) targets a fresh account using the operator's own credentials.
- FR-8.2. Stack outputs generate the client `app-config.json` automatically; no manual ID copying.
- FR-8.3. Docs let a new user deploy, create their account, set a passphrase, store a recovery code, configure meds/schedule, and start logging.
- FR-8.4. The **pharmacology extension** is documented and swappable with a worked example; replacing it requires no other code changes.
- FR-8.5. Repository contains LICENSE, README, SECURITY/contributing notes; **no secrets**; security guidance mandates SSO/short-lived creds, least privilege, sandbox-first.
- FR-8.6. `teardown` removes all resources (`cdk destroy`); docs advise exporting first.

## 5. Technical approach
- **Deploy wrapper:** a script/Make target chaining bootstrap (idempotent), deploy, build, S3 sync, CloudFront invalidation; prints the app URL; writes `app-config.json`.
- **Config generation:** read CDK outputs → emit client config; never hardcode IDs.
- **Docs set:** `README` (what/why/quickstart), `DEPLOY.md` (prereqs: AWS account, SSO/profile, Node; step-by-step; costs; teardown), `SECURITY.md` (credential handling, E2E model, recovery-code importance, threat notes), `EXTENSION.md` (the `DoseAdjustmentStrategy`/`levelSeries` contract + example implementation), `LICENSE` (e.g. MIT).
- **Onboarding:** first-run wizard — deploy-config check → create user → set passphrase → capture recovery code (with loss warning) → optional sample data.
- **Extension example:** a sample strategy file (clearly a template, not medical advice) showing where equations go and that outputs are cap-validated.
- **Release hardening:** strict CSP for the PWA; dependency audit in CI; production build checks.

## 6. Tasks
1. Build the one-command deploy wrapper + config generation.
2. Write `README`, `DEPLOY.md`, `SECURITY.md`, `EXTENSION.md`, add `LICENSE`.
3. Implement the first-run onboarding wizard (passphrase + recovery code capture).
4. Add the example extension strategy and document the contract.
5. Add CSP, dependency audit to CI, and a teardown path with export reminder.
6. Validate end-to-end on a brand-new sandbox account from docs only.

## 7. Acceptance criteria
- AC1. Given a fresh AWS account and the docs, when a new user follows `DEPLOY.md`, the full app is running in < 30 minutes.
- AC2. Given deploy completes, when the client starts, it uses the generated `app-config.json` with no manual ID entry.
- AC3. Given the example extension is replaced per `EXTENSION.md`, when a late dose is logged, the new equations drive the suggested dose and it is cap-validated — with no other code changes.
- AC4. Given the repo, when scanned, it contains no secrets and the docs mandate SSO/short-lived creds, least privilege, and sandbox-first.
- AC5. Given onboarding, when completed, the user has set a passphrase and stored a recovery code (with an explicit loss warning shown).
- AC6. Given teardown is run, when complete, all stack resources are removed (export-first advised).

## 8. Test plan
- Clean-account dry run from docs only (record the timing for AC1).
- Extension swap test (AC3) with a trivial example strategy.
- Secret-scan in CI; CSP smoke; dependency audit.
- Teardown verification on the sandbox.

## 9. Risks / decisions
- Open-source users mishandling AWS creds → docs and scripts enforce the secure path; never accept keys in any prompt or commit.
- Keep the extension boundary the **only** thing a self-hoster must touch for pharmacology — protects the safety model and lowers the bar to adopt.
- Reminder limits and the E2E/recovery tradeoff are stated plainly in docs (no over-promising).

## 10. Definition of done
All ACs pass; a clean account deploys from docs within target time; extension is swappable with a worked example; secure-by-default docs and scripts; teardown clean; release-hardening (CSP, audit) in place.
