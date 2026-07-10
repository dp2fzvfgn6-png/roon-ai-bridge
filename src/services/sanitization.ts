const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|oauth|bearer)/i;
const BINARY_IMAGE_KEY_PATTERN = /(image[_-]?base64|image[_-]?data|data[_-]?url)/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]{160,}={0,2}$/;
const MAX_STRING_LENGTH = 1200;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 80;

export function sanitizeValue(value: unknown, keyHint = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) return "[REDACTED]";
  if (BINARY_IMAGE_KEY_PATTERN.test(keyHint)) return "[REDACTED_IMAGE_DATA]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (SENSITIVE_KEY_PATTERN.test(value) && value.length > 16) return "[REDACTED]";
    if (BASE64_PATTERN.test(value)) return "[REDACTED_BASE64]";
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, keyHint));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = sanitizeValue(nested, key);
    }
    return output;
  }

  return String(value);
}

export function sanitizeText(text: unknown): string {
  const raw = String(text ?? "");
  return raw
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(API_TOKEN|PORTAL_ADMIN_TOKEN|OAUTH_APPROVAL_PIN|PASSWORD|SECRET)=\S+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9+/]{240,}={0,2}/g, "[REDACTED_BASE64]")
    .slice(0, 4000);
}

export function jsonStable(value: unknown): string {
  return JSON.stringify(sanitizeValue(value));
}
