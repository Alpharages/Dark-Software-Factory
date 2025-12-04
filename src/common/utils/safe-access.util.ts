/**
 * Safe Object Access Utilities
 *
 * Provides type-safe object property access patterns that satisfy ESLint
 * security/detect-object-injection rules without using eslint-disable.
 *
 * Story 2.16: Security lint warnings cleanup
 */

/**
 * Safely gets a property from an object using Object.hasOwn check.
 * This pattern satisfies ESLint security rules by validating key existence.
 *
 * @param obj - The object to access
 * @param key - The key to retrieve
 * @returns The value or undefined if key doesn't exist
 */
export function safeGet<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  key: K,
): T[K] | undefined {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }
  return undefined;
}

/**
 * Safely gets a property with a default value.
 *
 * @param obj - The object to access
 * @param key - The key to retrieve
 * @param defaultValue - Value to return if key doesn't exist
 * @returns The value or default
 */
export function safeGetWithDefault<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  key: K,
  defaultValue: T[K],
): T[K] {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }
  return defaultValue;
}

/**
 * Safely sets a property on an object.
 * Creates a new object to avoid mutation issues.
 *
 * @param obj - The object to modify
 * @param key - The key to set
 * @param value - The value to set
 * @returns New object with the property set
 */
export function safeSet<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K],
): T {
  return { ...obj, [key]: value };
}

/**
 * Safely increments a numeric counter in a record.
 * Commonly used for metrics tracking.
 *
 * @param counters - Record of counters
 * @param key - The counter key
 * @param increment - Amount to increment (default 1)
 */
export function safeIncrement<K extends string>(
  counters: Record<K, number>,
  key: K,
  increment = 1,
): void {
  if (Object.prototype.hasOwnProperty.call(counters, key)) {
    counters[key] = counters[key] + increment;
  } else {
    counters[key] = increment;
  }
}

/**
 * Creates a type-safe lookup function for enum-like records.
 * Returns a function that safely retrieves values.
 *
 * @param record - The record to create a lookup for
 * @returns A lookup function
 */
export function createLookup<K extends string | number | symbol, V>(
  record: Record<K, V>,
): (key: K) => V | undefined {
  const map = new Map<K, V>(Object.entries(record) as [K, V][]);
  return (key: K) => map.get(key);
}

/**
 * Creates a type-safe lookup function with default value.
 *
 * @param record - The record to create a lookup for
 * @param defaultValue - Default value when key not found
 * @returns A lookup function
 */
export function createLookupWithDefault<K extends string | number | symbol, V>(
  record: Record<K, V>,
  defaultValue: V,
): (key: K) => V {
  const map = new Map<K, V>(Object.entries(record) as [K, V][]);
  return (key: K) => map.get(key) ?? defaultValue;
}

/**
 * Type-safe Map wrapper for frequently accessed records.
 * Converts a Record to a Map for safer access patterns.
 */
export class SafeMap<K extends string | number | symbol, V> {
  private readonly map: Map<string, V>;

  constructor(record: Record<K, V>) {
    this.map = new Map(Object.entries(record));
  }

  get(key: K): V | undefined {
    return this.map.get(String(key));
  }

  getOrDefault(key: K, defaultValue: V): V {
    return this.map.get(String(key)) ?? defaultValue;
  }

  has(key: K): boolean {
    return this.map.has(String(key));
  }

  keys(): K[] {
    return Array.from(this.map.keys()) as K[];
  }

  values(): V[] {
    return Array.from(this.map.values());
  }

  entries(): [K, V][] {
    return Array.from(this.map.entries()) as [K, V][];
  }
}

/**
 * Safely iterates over object entries without triggering detect-object-injection.
 * The callback receives validated key-value pairs.
 *
 * @param obj - The object to iterate
 * @param callback - Function called for each entry
 */
export function safeForEach<T extends Record<string, unknown>>(
  obj: T,
  callback: (key: keyof T, value: T[keyof T]) => void,
): void {
  for (const [key, value] of Object.entries(obj)) {
    callback(key as keyof T, value as T[keyof T]);
  }
}

/**
 * Safely maps over object entries.
 *
 * @param obj - The object to map
 * @param callback - Transform function for each entry
 * @returns Array of transformed values
 */
export function safeMapEntries<T extends Record<string, unknown>, R>(
  obj: T,
  callback: (key: keyof T, value: T[keyof T]) => R,
): R[] {
  return Object.entries(obj).map(([key, value]) => callback(key as keyof T, value as T[keyof T]));
}

/**
 * Safely reduces object entries to a single value.
 *
 * @param obj - The object to reduce
 * @param callback - Reducer function
 * @param initial - Initial value
 * @returns Reduced value
 */
export function safeReduceEntries<T extends Record<string, unknown>, R>(
  obj: T,
  callback: (acc: R, key: keyof T, value: T[keyof T]) => R,
  initial: R,
): R {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => callback(acc, key as keyof T, value as T[keyof T]),
    initial,
  );
}

/**
 * Creates a safe copy of an object with a transformed value.
 * Useful for redacting sensitive fields.
 *
 * @param obj - Source object
 * @param transformer - Function to transform each value
 * @returns New object with transformed values
 */
export function safeTransform<T extends Record<string, unknown>>(
  obj: T,
  transformer: (key: keyof T, value: T[keyof T]) => T[keyof T],
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = transformer(key as keyof T, value as T[keyof T]);
  }
  return result as T;
}
