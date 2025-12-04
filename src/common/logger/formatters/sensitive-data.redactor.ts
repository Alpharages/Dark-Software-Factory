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

export function redactAuthHeader(value: string): string {
  if (!value) return value;
  if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
  if (value.startsWith('Basic ')) return 'Basic [REDACTED]';
  return REDACTED;
}
