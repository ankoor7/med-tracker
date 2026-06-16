# infra/ — backend & local dev environment (Stage 3)

The SteadyDose backend: a per-user, JWT-protected `/sync/*` API over DynamoDB,
plus Cognito auth and static hosting. It runs two ways from the **same handler
code**:

- **Local dev** — Docker (LocalStack + cognito-local) + a small Express server.
  No AWS account, no cost. This is the default for development.
- **Real AWS** — one CDK stack you deploy to your own account.

```
infra/
  sync/            shared, transport-agnostic logic (used by Lambda AND local server)
    types.ts         Envelope + SyncStore port
    handlerCore.ts   pull/push: per-user isolation, version guard (opaque payloads)
    dynamoStore.ts   SyncStore over DynamoDB (real or LocalStack)
    inMemoryStore.ts SyncStore for tests
  lambda/index.ts  AWS Lambda adapter (API Gateway v2 → handlerCore)
  local/           local dev: Express server, JWT verify, bootstrap, config
  cdk/             CDK app + stack, config generator, host-publish script
```

Why this split: LocalStack Community has **no Cognito** (and no CloudFront), so
auth uses **cognito-local** and the frontend is served by Vite in dev. The
`handlerCore` is identical in both worlds, so local behaviour matches prod.

---

## Local development

Prerequisites: Docker running.

```bash
pnpm local:up          # start LocalStack (DynamoDB) + cognito-local
pnpm local:bootstrap   # create the table, Cognito pool/client, a dev user
                       #   → writes .env.local and infra/local/local-config.json
pnpm local:api         # start the sync API on http://localhost:3001
pnpm dev               # start the app (reads .env.local) — sign in on the History tab
```

A ready dev account is created: **dev@steadydose.local / DevPassw0rd!**
(local-only, not a secret).

```bash
pnpm local:down        # stop containers (keep data)
pnpm local:reset       # stop + wipe all local data and generated config
```

Everything stored locally (`.localstack/`, `.cognito/`, `*.local`,
`local-config.json`) is gitignored.

---

## Deploying to your own AWS account

Prerequisites: AWS CLI v2 with SSO / a named profile (short-lived creds), and
CDK bootstrap once per account/region. **No secrets are committed** — deploy
uses your local credential chain.

```bash
cdk bootstrap                       # first time per account/region
pnpm deploy                         # cdk deploy → gen-config → build → publish
```

`pnpm deploy` runs:

1. `pnpm cdk:deploy` — provisions Cognito, DynamoDB (PITR + SSE-KMS, `byUpdatedAt`
   GSI), Lambda, HTTP API (JWT authorizer), private S3 + CloudFront (OAC); writes
   `cdk-outputs.json`.
2. `pnpm infra:gen-config` — writes `.env.production` from the outputs.
3. `pnpm build` — builds the PWA against that config.
4. `pnpm deploy:host` — `aws s3 sync` to the site bucket + CloudFront invalidation.

Teardown: `pnpm cdk:destroy`. (Data stores use `RETAIN`; remove them manually
after exporting if you truly want them gone.)

---

## What the server can / can't see

Records are opaque ciphertext envelopes `{ id, updatedAt, version, deleted,
ciphertext }` partitioned by the authenticated `userId`. At Stage 3 the handlers
do **not** decrypt anything (client-side E2E encryption is Stage 4; the full
sync engine — offline queue, LWW, change tracking — is Stage 5).
