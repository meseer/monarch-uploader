/**
 * Storage Adapter
 *
 * Abstracts storage operations behind a common interface.
 * The default implementation wraps Tampermonkey's GM_getValue/GM_setValue/etc.
 * Alternative implementations can be created for other environments
 * (e.g., localStorage, IndexedDB, native mobile storage).
 *
 * @module core/storageAdapter
 */

// ============================================================
// Canonical interface definition
// ============================================================

export interface StorageAdapter {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  listKeys(): string[];
}

// ============================================================
// Implementations
// ============================================================

/**
 * Create a storage adapter backed by Tampermonkey's GM_* APIs.
 *
 * This is the default adapter used in the userscript environment.
 * All GM_* calls are centralized here so that integration modules
 * and other code never reference GM_* functions directly.
 */
export function createGMStorageAdapter(): StorageAdapter {
  return {
    get(key: string, defaultValue?: unknown): unknown {
      return GM_getValue(key, defaultValue);
    },

    set(key: string, value: unknown): void {
      GM_setValue(key, value);
    },

    delete(key: string): void {
      GM_deleteValue(key);
    },

    listKeys(): string[] {
      return GM_listValues();
    },
  };
}

/**
 * Create an in-memory storage adapter for testing purposes.
 *
 * All data is stored in a plain object and lost when the adapter
 * is garbage-collected. Useful for unit tests.
 */
export function createMemoryStorageAdapter(initialData: Record<string, unknown> = {}): StorageAdapter {
  const store: Record<string, unknown> = { ...initialData };

  return {
    get(key: string, defaultValue?: unknown): unknown {
      return key in store ? store[key] : defaultValue;
    },

    set(key: string, value: unknown): void {
      store[key] = value;
    },

    delete(key: string): void {
      delete store[key];
    },

    listKeys(): string[] {
      return Object.keys(store);
    },
  };
}

export default {
  createGMStorageAdapter,
  createMemoryStorageAdapter,
};