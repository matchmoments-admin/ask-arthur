type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};

// Mask an E.164 phone so logs carry diagnostic signal without raw PII.
// +61412345678 -> +61********78 (country code + last 2 digits).
export function maskE164(e164: string): string {
  if (!e164 || e164.length < 5) return "***";
  const cc = e164.startsWith("+") ? e164.slice(0, 3) : e164.slice(0, 2);
  const tail = e164.slice(-2);
  return `${cc}${"*".repeat(Math.max(0, e164.length - cc.length - 2))}${tail}`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, local.length - 1))}${domain}`;
}
