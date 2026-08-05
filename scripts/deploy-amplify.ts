/**
 * Deploy Recall to AWS Amplify Hosting.
 *
 * Amplify builds the Next.js app directly from the GitHub repo (no Docker, no
 * ECR). This script builds the `aws amplify create-app` payload from
 * .env.local, fixing the CockroachDB URL for the cloud (sslmode=require, no
 * local cert path).
 *
 * Prerequisites:
 *   1. The IAM user has AdministratorAccess-Amplify (or AmazonAmplifyFullAccess
 *      + iam:CreateRole).
 *   2. AWS CLI configured with that user's keys (profile name "apprunner").
 *   3. A GitHub PAT with `repo` scope (or fine-grained read access to the
 *      PhiBao/recall repository). Export it as GITHUB_TOKEN.
 *
 * Usage:
 *   AWS_PROFILE=apprunner GITHUB_TOKEN=ghp_xxx tsx scripts/deploy-amplify.ts
 *
 * Then create the branch (main) which triggers the first build:
 *   aws amplify create-branch --app-id <APP_ID> --branch-name main
 *   aws amplify start-deployment --app-id <APP_ID> --branch-name main
 */
import { readFileSync } from "node:fs";
import { loadEnv } from "./load-env";
loadEnv();

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function fixDatabaseUrl(url: string): string {
  return url
    .replace("sslmode=verify-full", "sslmode=require")
    .replace(/&sslrootcert=[^&]*/, "");
}

async function main() {
  const env = parseEnv(".env.local");

  const envVars = {
    DATABASE_URL: fixDatabaseUrl(env["DATABASE_URL"] ?? ""),
    AUTH_SECRET: env["AUTH_SECRET"] ?? "",
    // Amplify reserves the "AWS_" env prefix (including AWS_REGION), so the
    // Bedrock IAM keys go in under RECALL_AWS_* (lib/ai.ts prefers them,
    // falls back to AWS_* locally) and the region uses the code default.
    RECALL_AWS_ACCESS_KEY_ID: env["AWS_ACCESS_KEY_ID"] ?? "",
    RECALL_AWS_SECRET_ACCESS_KEY: env["AWS_SECRET_ACCESS_KEY"] ?? "",
    BEDROCK_API_KEY: env["BEDROCK_API_KEY"] ?? "",
    BEDROCK_TEXT_MODEL_ID: env["BEDROCK_TEXT_MODEL_ID"] ?? "mistral.voxtral-mini-3b-2507",
    BEDROCK_EMBED_MODEL_ID: env["BEDROCK_EMBED_MODEL_ID"] ?? "amazon.titan-embed-text-v2:0",
    EMBED_DIMENSIONS: env["EMBED_DIMENSIONS"] ?? "1024",
    AI_PROVIDER: env["AI_PROVIDER"] ?? "bedrock",
    NODE_ENV: "production",
  };

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "[deploy] GITHUB_TOKEN is required — create a GitHub PAT with repo access and export it.",
    );
    process.exit(1);
  }

  const envStr = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

  // Print the command for the operator to run (avoids embedding the PAT in a
  // committed script, and lets you inspect what's being sent).
  const cmd = [
    "aws amplify create-app",
    `--name recall`,
    `--repository https://github.com/PhiBao/recall`,
    `--platform WEB_COMPUTE`,
    `--access-token ${token}`,
    `--compute-role-arn arn:aws:iam::381492277789:role/AmplifySSRComputeRole`,
    `--environment-variables "${envStr}"`,
  ].join(" ");

  console.log("[deploy] Run this to create the Amplify app:\n");
  console.log(`  AWS_PROFILE=apprunner ${cmd}\n`);
  console.log("[deploy] Then create the branch (first build):");
  console.log("  aws amplify create-branch --app-id <APP_ID> --branch-name main");
  console.log("[deploy] Output env vars for reference (secrets redacted):");
  for (const [k, v] of Object.entries(envVars)) {
    const shown =
      k.includes("SECRET") || k.includes("KEY") || k === "AUTH_SECRET"
        ? "***"
        : v.length > 60
          ? v.slice(0, 60) + "…"
          : v;
    console.log(`  ${k}=${shown}`);
  }
}

main().catch((err) => {
  console.error("[deploy] failed:", err);
  process.exit(1);
});
