/**
 * Zero-dependency .env loader for CLI scripts (migrate/seed/nudges).
 * Next.js loads env automatically for the app; standalone tsx scripts do not,
 * so we parse .env.local then .env (local wins) without adding a dependency.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseAndApply(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnv() {
  const cwd = process.cwd();
  // .env.local takes precedence over .env because we load it first
  // (parseAndApply only sets keys that are still undefined).
  parseAndApply(join(cwd, ".env.local"));
  parseAndApply(join(cwd, ".env"));
}
