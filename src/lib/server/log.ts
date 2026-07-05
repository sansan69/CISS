export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Structured logger that prefixes messages with [area] [level] for easy
 * grepping in Vercel/cloud logs.
 *
 * - error → console.error
 * - warn  → console.warn
 * - info  → console.log
 * - debug → console.log
 */
export function log(
  level: LogLevel,
  area: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `[${area}] [${level}]`;
  const fullMessage = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

  switch (level) {
    case "error":
      console.error(fullMessage);
      break;
    case "warn":
      console.warn(fullMessage);
      break;
    case "info":
    case "debug":
      console.log(fullMessage);
      break;
  }
}
