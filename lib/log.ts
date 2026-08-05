/**
 * Tiny structured logger.
 *
 * Emits one JSON line per event to stdout so a log collector (CloudWatch Logs,
 * the App Runner log stream) can index and query fields instead of parsing
 * prose. Every line shares `service`, `env`, and `timestamp` so filters are
 * consistent. Keep it dependency-free — this is the only logging primitive.
 */
import { env } from "./env";

type Fields = Record<string, unknown>;

function emit(level: string, event: string, fields: Fields = {}): void {
  const e = env();
  const line = JSON.stringify({
    service: "recall",
    env: e.NODE_ENV,
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info(event: string, fields: Fields = {}): void {
    emit("info", event, fields);
  },
  warn(event: string, fields: Fields = {}): void {
    emit("warn", event, fields);
  },
  error(event: string, fields: Fields = {}): void {
    emit("error", event, fields);
  },
};
