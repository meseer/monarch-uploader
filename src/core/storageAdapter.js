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

/**
 * @typedef {Object} StorageAdapter
 * @property {function(string, *=): *} get - Get a value by key, with optional default
 * @property {function(string, *): void} set - Set a value by key
 * @property {function(string): void} delete - Delete a value by key
 * @property {function(): string[]} listKeys - List all stored keys
 */

/**
 * Create a storage adapter backed by Tampermonkey's GM_* APIs.
 *
 * This is the default adapter used in the userscript environment.
 * All GM_* calls are centralized here so that integration modules
 * and other code never reference GM_* functions directly.
 *
 * @returns {StorageAdapter} A storage adapter instance
 */
export function createGMStorageAdapter() {
  return {
    /**
     * Get a stored value
     * @param {string} key - Storage key
     * @param {*} [defaultValue=undefined] - Default value if key doesn't exist
     * @returns {*} The stored value or defaultValue
     */
    get(key, defaultValue) {
      return GM_getValue(key, defaultValue);
    },

    /**
     * Set a stored value
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     */
    set(key, value) {
      GM_setValue(key, value);
    },

    /**
     * Delete a stored value
     * @param {string} key - Storage key to delete
     */
    delete(key) {
      GM_deleteValue(key);
    },

    /**
     * List all stored keys
     * @returns {string[]} Array of all stored key names
     */
    listKeys() {
      return GM_listValues();
    },
  };
}

/**
 * Create an in-memory storage adapter for testing purposes.
 *
 * All data is stored in a plain object and lost when the adapter
 * is garbage-collected. Useful for unit tests.
 *
 * @param {Object} [initialData={}] - Optional initial data to populate
 * @returns {StorageAdapter} An in-memory storage adapter instance
 */
export function createMemoryStorageAdapter(initialData = {}) {
  const store = { ...initialData };

  return {
    get(key, defaultValue) {
      return key in store ? store[key] : defaultValue;
    },

    set(key, value) {
      store[key] = value;
    },

    delete(key) {
      delete store[key];
    },

    listKeys() {
      return Object.keys(store);
    },
  };
}

export default {
  createGMStorageAdapter,
  createMemoryStorageAdapter,
};