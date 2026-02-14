/**
 * Tests for Storage Adapter
 * @module test/core/storageAdapter
 */

import { createMemoryStorageAdapter } from '../../src/core/storageAdapter';

describe('storageAdapter', () => {
  describe('createMemoryStorageAdapter', () => {
    let storage;

    beforeEach(() => {
      storage = createMemoryStorageAdapter();
    });

    describe('get', () => {
      it('should return undefined for missing key with no default', () => {
        expect(storage.get('nonexistent')).toBeUndefined();
      });

      it('should return default value for missing key', () => {
        expect(storage.get('nonexistent', 'fallback')).toBe('fallback');
      });

      it('should return stored value when key exists', () => {
        storage.set('myKey', 'myValue');
        expect(storage.get('myKey')).toBe('myValue');
      });

      it('should return stored value even when default is provided', () => {
        storage.set('myKey', 'myValue');
        expect(storage.get('myKey', 'fallback')).toBe('myValue');
      });

      it('should handle falsy stored values correctly', () => {
        storage.set('zero', 0);
        storage.set('empty', '');
        storage.set('false', false);
        storage.set('null', null);

        expect(storage.get('zero', 'default')).toBe(0);
        expect(storage.get('empty', 'default')).toBe('');
        expect(storage.get('false', 'default')).toBe(false);
        expect(storage.get('null', 'default')).toBeNull();
      });
    });

    describe('set', () => {
      it('should store a string value', () => {
        storage.set('key', 'value');
        expect(storage.get('key')).toBe('value');
      });

      it('should store a number value', () => {
        storage.set('key', 42);
        expect(storage.get('key')).toBe(42);
      });

      it('should store an object value', () => {
        const obj = { a: 1, b: 'two' };
        storage.set('key', obj);
        expect(storage.get('key')).toEqual(obj);
      });

      it('should store an array value', () => {
        const arr = [1, 2, 3];
        storage.set('key', arr);
        expect(storage.get('key')).toEqual(arr);
      });

      it('should overwrite existing value', () => {
        storage.set('key', 'first');
        storage.set('key', 'second');
        expect(storage.get('key')).toBe('second');
      });
    });

    describe('delete', () => {
      it('should remove a stored key', () => {
        storage.set('key', 'value');
        storage.delete('key');
        expect(storage.get('key')).toBeUndefined();
      });

      it('should not throw when deleting a nonexistent key', () => {
        expect(() => storage.delete('nonexistent')).not.toThrow();
      });

      it('should only delete the specified key', () => {
        storage.set('key1', 'value1');
        storage.set('key2', 'value2');
        storage.delete('key1');
        expect(storage.get('key1')).toBeUndefined();
        expect(storage.get('key2')).toBe('value2');
      });
    });

    describe('listKeys', () => {
      it('should return empty array when no keys are stored', () => {
        expect(storage.listKeys()).toEqual([]);
      });

      it('should return all stored keys', () => {
        storage.set('a', 1);
        storage.set('b', 2);
        storage.set('c', 3);
        const keys = storage.listKeys();
        expect(keys).toHaveLength(3);
        expect(keys).toContain('a');
        expect(keys).toContain('b');
        expect(keys).toContain('c');
      });

      it('should not include deleted keys', () => {
        storage.set('a', 1);
        storage.set('b', 2);
        storage.delete('a');
        expect(storage.listKeys()).toEqual(['b']);
      });
    });

    describe('initialData', () => {
      it('should pre-populate with initial data', () => {
        const initialStorage = createMemoryStorageAdapter({
          token: 'abc123',
          count: 5,
        });

        expect(initialStorage.get('token')).toBe('abc123');
        expect(initialStorage.get('count')).toBe(5);
        expect(initialStorage.listKeys()).toHaveLength(2);
      });

      it('should not mutate the initial data object', () => {
        const initial = { key: 'original' };
        const initialStorage = createMemoryStorageAdapter(initial);
        initialStorage.set('key', 'modified');

        expect(initial.key).toBe('original');
        expect(initialStorage.get('key')).toBe('modified');
      });
    });
  });
});