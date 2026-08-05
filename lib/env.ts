import { z } from "zod";

/**
 * Centralized, validated environment access.
 * Fails fast at startup if required configuration is missing, so we never
 * ship a build that silently misbehaves in production.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),

  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Bedrock API key (bearer token) — the simple auth path. Either this or IAM creds.
  BEDROCK_API_KEY: z.string().optional(),

  BEDROCK_TEXT_MODEL_ID: z.string().default("amazon.nova-micro-v1:0"),
  BEDROCK_EMBED_MODEL_ID: z.string().default("amazon.titan-embed-text-v2:0"),
  EMBED_DIMENSIONS: z.coerce.number().int().positive().default(1024),

  AI_PROVIDER: z.enum(["bedrock", "mock"]).default("bedrock"),

  APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when no Bedrock auth is configured or AI_PROVIDER=mock — use deterministic local AI. */
export function isMockAI(): boolean {
  const e = env();
  if (e.AI_PROVIDER === "mock") return true;
  if (e.BEDROCK_API_KEY) return false;
  return !e.AWS_ACCESS_KEY_ID || !e.AWS_SECRET_ACCESS_KEY;
}
