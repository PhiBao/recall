import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = [
    "DATABASE_URL",
    "AUTH_SECRET",
    "RECALL_AWS_ACCESS_KEY_ID",
    "RECALL_AWS_SECRET_ACCESS_KEY",
    "BEDROCK_API_KEY",
    "AI_PROVIDER",
    "NODE_ENV",
    "AWS_REGION",
  ];
  const info: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k] ?? "";
    info[k] = k.includes("SECRET") || k.includes("KEY") || k === "AUTH_SECRET"
      ? v ? "set(len=" + v.length + ")" : "MISSING"
      : v ? v.slice(0, 60) : "MISSING";
  }
  info["SSL_MODE"] = (process.env.DATABASE_URL ?? "").includes("sslmode=require")
    ? "require"
    : "other";
  return NextResponse.json(info);
}
