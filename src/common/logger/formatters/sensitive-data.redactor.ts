import { SENSITIVE_FIELDS } from '../logger.interface';

const REDACTED = '[REDACTED]';

export function redactSensitiveData(obj: unknown, additionalFields: string[] = []): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, additionalFields));
  }

  const sensitiveFieldsSet = new Set([
    ...SENSITIVE_FIELDS,
    ...additionalFields.map((f) => f.toLowerCase()),
  ]);

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    // Check for exact or partial sensitive field match
    const isSensitive =
      sensitiveFieldsSet.has(keyLower) ||
      Array.from(sensitiveFieldsSet).some(
        (field) => keyLower.includes(field) || field.includes(keyLower),
      );

    if (isSensitive) {
      Reflect.set(redacted, key, REDACTED);
    } else if (typeof value === 'object' && value !== null) {
      Reflect.set(redacted, key, redactSensitiveData(value, additionalFields));
    } else {
      Reflect.set(redacted, key, value);
    }
  }

  return redacted;
}

// GitHub Token Patterns
const TOKEN_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,
  /ghs_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
];

export function redactString(value: string): string {
  if (!value) return value;
  let redacted = value;

  // Redact GitHub Tokens
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_TOKEN]');
  }

  return redacted;
}

export function redactAuthHeader(value: string): string {
  if (!value) return value;
  if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
  if (value.startsWith('Basic ')) return 'Basic [REDACTED]';
  return REDACTED;
}
