# Deploying Recall on AWS Amplify Hosting

> App Runner no longer accepts new customers (as of April 30, 2026), so Recall
> is deployed on **AWS Amplify Hosting** instead — AWS's native Next.js hosting.
> Amplify builds the app directly from the GitHub repo: no Docker, no ECR, no
> container image to maintain. It gives you a public HTTPS URL on the free tier.

## Architecture on Amplify

- **Source:** `https://github.com/PhiBao/recall` (branch `main`) via a GitHub PAT
- **Platform:** `WEB_COMPUTE` (Next.js SSR / server actions support)
- **Build:** `amplify.yml` (corepack + pnpm install + pnpm build)
- **Runtime env:** AUTH_SECRET, Bedrock keys/model IDs, MEMWAL_* (Walrus operator
  account) — set via `--environment-variables`. No database URL: durable memory
  lives in Walrus Memory; the structured projection is a local JSON file
  (ephemeral on Amplify — Walrus remains the source of truth).
- **Demo URL:** `https://main.<APP_ID>.amplifyapp.com`

The Next.js app runs as a server (server actions, `/api/health`) on Amplify's
compute platform, so the whole product works exactly as it does locally.

## Prerequisites (one-time, ~5 min)

### 1. Grant the IAM user Amplify access

In the AWS console → IAM → Users → `apprunner` → Permissions → **Add permissions** →
Attach policy → add:

- **`AdministratorAccess-Amplify`** (covers `amplify:*`, `iam:CreateRole`,
  `iam:CreateServiceLinkedRole`, S3/CloudWatch access Amplify needs).

(Or, if you'd rather not use the admin-scoped one, `AmazonAmplifyFullAccess`
+ a manually-created SSR compute role — the admin policy is simpler.)

### 2. Create a GitHub Personal Access Token

GitHub → Settings → Developer settings → Personal access tokens → **Tokens
(classic)** → Generate new token → scopes: **`repo`** (full). Copy the token;
you'll export it as `GITHUB_TOKEN` for one command. It is used only to let
Amplify clone the public repo at deploy time; you can revoke it after.

### 3. Verify the IAM user can assume the CLI profile

```bash
export PATH="$HOME/.local/bin:$PATH"
aws sts get-caller-identity --profile apprunner   # should show user/apprunner
```

## Deploy

```bash
cd recall
set -a; source .env.local; set +a
export GITHUB_TOKEN=ghp_xxx
export AWS_PROFILE=apprunner
export PATH="$HOME/.local/bin:$PATH"

# 1. Create the two IAM roles Amplify needs (service role + SSR compute role)
aws iam create-role --role-name AmplifyServiceRoleRecall \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"amplify.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name AmplifyServiceRoleRecall \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess-Amplify
# (also create AmplifySSRComputeRole with bedrock:InvokeModel + ssm:GetParametersByPath
#  on /amplify/<APP_ID>/* — see the policy in the run notes)

# 2. Create the Amplify app (env vars from .env.local, DB URL fixed)
aws amplify create-app \
  --name recall \
  --repository https://github.com/PhiBao/recall \
  --platform WEB_COMPUTE \
  --access-token "$GITHUB_TOKEN" \
  --iam-service-role-arn arn:aws:iam::381492277789:role/AmplifyServiceRoleRecall \
  --compute-role-arn arn:aws:iam::381492277789:role/AmplifySSRComputeRole \
  --environment-variables "$(env | grep -E '^(AUTH_SECRET|AWS_|RECALL_|BEDROCK_|MEMWAL_|AI_PROVIDER|NODE_ENV)=' | tr '\n' ',')"

# 3. Create the branch, THEN set env vars again (create-branch drops them)
aws amplify create-branch --app-id <APP_ID> --branch-name main \
  --framework "Next.js - SSR"
aws amplify update-branch --app-id <APP_ID> --branch-name main \
  --environment-variables "$(cat /tmp/amplify-env.txt)"
```

`deploy-amplify.ts` prints the exact command with env vars derived from
`.env.local`.

## Gotchas learned the hard way (read before deploying)

1. **The SSR runtime doesn't reliably receive branch env vars.** Even with them
   set at app + branch level, `process.env` in the running compute showed
   everything MISSING. The fix that works: `amplify.yml` materializes
   `.env.production` during `preBuild` from the build-time `$VAR`s (which
   Amplify does inject once the service role can read SSM). Next.js loads that
   file at runtime. Keep that step in `amplify.yml`.
2. **The build failed to read SSM** ("Failed to set up process.env.secrets")
   until the app had an **IAM service role** (`--iam-service-role-arn`) with
   `AdministratorAccess-Amplify`. Without it, Amplify can't fetch env vars from
   Parameter Store (`/amplify/<appId>/<branch>/*`).
3. **Amplify rejects `AWS_`-prefixed env vars.** The app needs no IAM keys at
   all (Bedrock Mantle uses a bearer API key; Walrus/TypeSafe use theirs), so
   nothing is lost — just don't set any `AWS_*` vars.
4. **The framework must be "Next.js - SSR"** (not "Next.js 15") or the deploy
   step fails with a CustomerError even though the build succeeds.

## Post-deploy

1. `aws amplify list-jobs --app-id <APP_ID> --branch-name main` to watch the build.
2. Open the returned URL: `https://main.<APP_ID>.amplifyapp.com`
3. Check `GET /api/health` → expect `status: ok`, `walrus.reachable: true`,
   `counts.walrus_blobs ≥ 10`.
4. Seed from your local machine ONLY for a local demo. The Amplify projection
   is ephemeral — each deploy starts empty, and Walrus blobs are per-user
   namespace, so production memories must be captured through the live app
   (sign in as `demo@recall.app` there and capture the same six stories, or
   run the demo script from `docs/video-script.md`).

## Required AWS services (hackathon checklist)

| Service | Used for | Required? |
|---|---|---|
| Amazon Bedrock (Voxtral Mini 3B) | extraction + recall synthesis + rerank (non-Anthropic/OpenAI → Beyond the Big Two) | Yes (LLM) |
| Walrus Memory (mainnet) | durable, encrypted, portable memory blobs + semantic recall | Yes (Session requirement) |
| AWS Amplify Hosting | hosts the live demo URL (Next.js SSR) | Yes (deployment) |
| AWS Lambda + EventBridge | daily nudge cron (`infra/nudge-lambda.ts`) | Extra (strengthens entry) |

> The Session requires: deployed chatbot + all memory on Walrus mainnet.
> Amplify hosts the chatbot; MEMWAL_* env vars point it at the operator
> account that owns the blobs.



