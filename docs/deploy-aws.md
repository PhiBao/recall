# Deploying Recall on AWS (App Runner + Lambda)

The hackathon requires a functional demo URL deployed on AWS. This runbook
covers the two deployment targets:

- **App Runner** — hosts the Next.js app (the demo URL judges will open).
- **Lambda + EventBridge** — runs the daily nudge cron serverlessly.

## 1. App Runner (the demo URL)

### Build & push the image

```bash
# Build the standalone container
docker build -t recall .

# Tag for ECR (replace 123456789012 with your AWS account, pick a region)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
docker tag recall:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/recall:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/recall:latest
```

### Create the App Runner service

In the AWS Console → App Runner → **Create a service**:

- **Source**: Container registry → Amazon ECR → select the `recall` image.
- **Deployment settings**: Automatic deployments (optional).
- **Configuration**:
  - Port: `3000`
  - CPU: 1 vCPU, Memory: 2 GB (the free tier covers the smallest config).
- **Environment variables** (set these in the App Runner config — NOT in the image):
  - `DATABASE_URL` — your CockroachDB Cloud connection string
  - `AUTH_SECRET` — a long random string (`openssl rand -base64 48`)
  - `AWS_REGION` — e.g. `us-east-1`
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — IAM keys for Titan embeddings
  - `BEDROCK_API_KEY` — your Bedrock API key
  - `BEDROCK_TEXT_MODEL_ID` — `mistral.voxtral-mini-3b-2507`
  - `BEDROCK_EMBED_MODEL_ID` — `amazon.titan-embed-text-v2:0`
  - `EMBED_DIMENSIONS` — `1024`
  - `NODE_ENV` — `production`
  - `APP_URL` — the App Runner URL (set this after first deploy, then redeploy)
- **Health check**: HTTP, path `/api/health`, interval 10s, healthy threshold 1.
  The health check verifies DB connectivity + vector index presence.

App Runner gives you a public `*.awsapprunner.com` URL — that's your demo URL.

### Post-deploy

1. Visit `/api/health` on the new URL — confirm `database: connected`,
   `vectorIndex: present`, `ai: bedrock`.
2. Seed the demo data from any machine that has the env vars:
   ```bash
   pnpm db:seed
   ```
3. Sign in as `demo@recall.app` and verify capture + recall + Today feed.

## 2. Lambda + EventBridge (the nudge cron)

The daily "reconnect with people who went cold" job runs serverlessly.

```bash
# Bundle the handler (pg is the only dependency; bundle it or use a layer).
cd infra
npm init -y && npm i pg esbuild
npx esbuild nudge-lambda.ts --bundle --platform=node --target=node22 \
  --outfile=dist/nudge-lambda.js --packages=external
# Zip the bundle for Lambda upload.
cd dist && zip ../nudge-lambda.zip nudge-lambda.js
```

Create a Lambda function:
- Runtime: Node.js 22, handler `nudge-lambda.handler` (the zip exports `handler`).
- Env: `DATABASE_URL`, `NODE_ENV=production`.
- Trigger: EventBridge rule → `rate(1 day)`.

The handler is idempotent and audited — every nudge it creates is written to
`audit_log`. Verify with: `pnpm nudge:run` locally (same logic), then check the
Today feed.

## Required AWS services (hackathon checklist)

| Service | Used for | Required? |
|---|---|---|
| Amazon Bedrock | chat (Mantle) + embeddings (Titan) | Yes (≥1 required) |
| AWS App Runner | hosts the demo | Yes (deployment) |
| AWS Lambda | daily nudge cron | Extra (strengthens entry) |
| EventBridge | schedules the Lambda | Extra |
