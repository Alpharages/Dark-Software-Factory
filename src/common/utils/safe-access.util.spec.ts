import {
  safeGet,
  safeGetWithDefault,
  safeSet,
  safeIncrement,
  createLookup,
  createLookupWithDefault,
  SafeMap,
  safeForEach,
  safeMapEntries,
  safeReduceEntries,
  safeTransform,
} from './safe-access.util';

describe('safe-access.util', () => {
  describe('safeGet', () => {
    it('should return value for existing key', () => {
      const obj = { foo: 'bar', num: 42 };
      expect(safeGet(obj, 'foo')).toBe('bar');
      expect(safeGet(obj, 'num')).toBe(42);
    });

    it('should return undefined for non-existing key', () => {
      const obj: Record<string, string> = { foo: 'bar' };
      expect(safeGet(obj, 'missing')).toBeUndefined();
    });

    it('should handle empty objects', () => {
      const obj: Record<string, unknown> = {};
      expect(safeGet(obj, 'any')).toBeUndefined();
    });
  });

  describe('safeGetWithDefault', () => {
    it('should return value for existing key', () => {
      const obj = { foo: 'bar' };
      expect(safeGetWithDefault(obj, 'foo', 'default')).toBe('bar');
    });

    it('should return default for non-existing key', () => {
      const obj: Record<string, string> = { foo: 'bar' };
      expect(safeGetWithDefault(obj, 'missing', 'default')).toBe('default');
    });
  });

  describe('safeSet', () => {
    it('should return new object with updated value', () => {
      const obj = { foo: 'bar', num: 42 };
      const result = safeSet(obj, 'foo', 'updated');

      expect(result.foo).toBe('updated');
      expect(obj.foo).toBe('bar'); // Original unchanged
    });

    it('should preserve other properties', () => {
      const obj = { foo: 'bar', num: 42 };
      const result = safeSet(obj, 'foo', 'updated');

      expect(result.num).toBe(42);
    });
  });

  describe('safeIncrement', () => {
    it('should increment existing counter', () => {
      const counters: Record<string, number> = { count: 5 };
      safeIncrement(counters, 'count');

      expect(counters.count).toBe(6);
    });

    it('should initialize new counter', () => {
      const counters: Record<string, number> = {};
      safeIncrement(counters, 'newCount');

      expect(counters.newCount).toBe(1);
    });

    it('should support custom increment', () => {
      const counters: Record<string, number> = { count: 5 };
      safeIncrement(counters, 'count', 10);

      expect(counters.count).toBe(15);
    });
  });

  describe('createLookup', () => {
    it('should create lookup function from record', () => {
      const record = { a: 1, b: 2, c: 3 };
      const lookup = createLookup(record);

      expect(lookup('a')).toBe(1);
      expect(lookup('b')).toBe(2);
      expect(lookup('c')).toBe(3);
    });

    it('should return undefined for missing keys', () => {
      const record = { a: 1 };
      const lookup = createLookup(record);

      expect(lookup('missing' as 'a')).toBeUndefined();
    });
  });

  describe('createLookupWithDefault', () => {
    it('should return value for existing key', () => {
      const record = { a: 'one', b: 'two' };
      const lookup = createLookupWithDefault(record, 'default');

      expect(lookup('a')).toBe('one');
    });

    it('should return default for missing key', () => {
      const record = { a: 'one' };
      const lookup = createLookupWithDefault(record, 'default');

      expect(lookup('missing' as 'a')).toBe('default');
    });
  });

  describe('SafeMap', () => {
    it('should get values by key', () => {
      const map = new SafeMap({ foo: 'bar', num: 42 });

      expect(map.get('foo')).toBe('bar');
      expect(map.get('num')).toBe(42);
    });

    it('should return undefined for missing keys', () => {
      const map = new SafeMap({ foo: 'bar' });

      expect(map.get('missing' as 'foo')).toBeUndefined();
    });

    it('should return default for missing keys', () => {
      const map = new SafeMap({ foo: 'bar' });

      expect(map.getOrDefault('missing' as 'foo', 'default')).toBe('default');
    });

    it('should check key existence', () => {
      const map = new SafeMap({ foo: 'bar' });

      expect(map.has('foo')).toBe(true);
      expect(map.has('missing' as 'foo')).toBe(false);
    });

    it('should return keys', () => {
      const map = new SafeMap({ a: 1, b: 2 });
      const keys = map.keys();

      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('should return values', () => {
      const map = new SafeMap({ a: 1, b: 2 });
      const values = map.values();

      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('should return entries', () => {
      const map = new SafeMap({ a: 1, b: 2 });
      const entries = map.entries();

      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
    });
  });

  describe('safeForEach', () => {
    it('should iterate over all entries', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const results: [string, number][] = [];

      safeForEach(obj, (key, value) => {
        results.push([key as string, value as number]);
      });

      expect(results).toHaveLength(3);
      expect(results).toContainEqual(['a', 1]);
      expect(results).toContainEqual(['b', 2]);
      expect(results).toContainEqual(['c', 3]);
    });
  });

  describe('safeMapEntries', () => {
    it('should map entries to new values', () => {
      const obj = { a: 1, b: 2 };
      const result = safeMapEntries(obj, (key, value) => `${key}=${value}`);

      expect(result).toContain('a=1');
      expect(result).toContain('b=2');
    });
  });

  describe('safeReduceEntries', () => {
    it('should reduce entries to single value', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const sum = safeReduceEntries(obj, (acc, _key, value) => acc + (value as number), 0);

      expect(sum).toBe(6);
    });
  });

  describe('safeTransform', () => {
    it('should transform object values', () => {
      const obj = { name: 'secret', password: 'hidden' };
      const result = safeTransform(obj, (key, value) => {
        if (key === 'password') return '[REDACTED]';
        return value;
      });

      expect(result.name).toBe('secret');
      expect(result.password).toBe('[REDACTED]');
    });

    it('should not mutate original object', () => {
      const obj = { name: 'test', secret: 'value' };
      safeTransform(obj, () => 'changed');

      expect(obj.name).toBe('test');
      expect(obj.secret).toBe('value');
    });
  });
});
