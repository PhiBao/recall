/**
 * Deploy Recall to AWS Amplify Hosting.
 *
 * Amplify builds the Next.js app directly from the GitHub repo (no Docker, no
 * ECR). This script builds the `aws amplify create-app` payload from
 * .env.local. There is no database URL anymore: durable memory lives in
 * Walrus Memory (MEMWAL_*), and the structured projection is a local JSON
 * file (ephemeral on Amplify — Walrus remains the source of truth).
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

async function main() {
  const env = parseEnv(".env.local");

  const envVars = {
    AUTH_SECRET: env["AUTH_SECRET"] ?? "",
    BEDROCK_API_KEY: env["BEDROCK_API_KEY"] ?? "",
    BEDROCK_TEXT_MODEL_ID: env["BEDROCK_TEXT_MODEL_ID"] ?? "mistral.voxtral-mini-3b-2507",
    AI_PROVIDER: env["AI_PROVIDER"] ?? "bedrock",
    // Walrus Memory operator account — durable memory layer (mainnet).
    MEMWAL_PRIVATE_KEY: env["MEMWAL_PRIVATE_KEY"] ?? "",
    MEMWAL_ACCOUNT_ID: env["MEMWAL_ACCOUNT_ID"] ?? "",
    MEMWAL_SERVER_URL: env["MEMWAL_SERVER_URL"] ?? "https://relayer.memory.walrus.xyz",
    // TypeSafe (Jev) — calibrated judgments; falls back to Bedrock when empty.
    TYPESAFE_API_KEY: env["TYPESAFE_API_KEY"] ?? "",
    TYPESAFE_MODEL_ID: env["TYPESAFE_MODEL_ID"] ?? "jev-latest",
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
    `--iam-service-role-arn arn:aws:iam::381492277789:role/AmplifyServiceRoleRecall`,
    `--compute-role-arn arn:aws:iam::381492277789:role/AmplifySSRComputeRole`,
    `--environment-variables "${envStr}"`,
  ].join(" ");

  console.log("[deploy] Run this to create the Amplify app:\n");
  console.log(`  AWS_PROFILE=apprunner ${cmd}\n`);
  console.log("[deploy] Then create the branch (SSR framework is mandatory):");
  console.log('  aws amplify create-branch --app-id <APP_ID> --branch-name main --framework "Next.js - SSR"');
  console.log("[deploy] Then re-set env vars on the branch (create-branch drops them):");
  console.log(`  aws amplify update-branch --app-id <APP_ID> --branch-name main --environment-variables "${envStr}"`);
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
