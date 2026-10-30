import nodeCrypto from 'crypto';
import { ReadableStream, TransformStream, WritableStream } from 'stream/web';
import { TextEncoder } from 'util';

// Expose Web Streams globals inside Vitest vmThreads contexts so packages like
// jsdom/undici can be imported in build/smoke tests.
globalThis.ReadableStream ??= ReadableStream;
globalThis.WritableStream ??= WritableStream;
globalThis.TransformStream ??= TransformStream;

// Mock for TextEncoder (used by Web Crypto API)
global.TextEncoder = TextEncoder;

// Mock for Web Crypto API (crypto.subtle)
// JSDOM has a crypto object but without subtle, so we need to add it
// Use Node.js built-in crypto for real SHA-256 hashing to avoid collisions
const mockDigest = vi.fn(async (algorithm, data) => {
  const algoName = algorithm.replace('-', '').toLowerCase(); // 'SHA-256' -> 'sha256'
  const hash = nodeCrypto.createHash(algoName).update(Buffer.from(data)).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
});

// Define subtle on the existing crypto object or create new one
if (typeof crypto !== 'undefined') {
  Object.defineProperty(crypto, 'subtle', {
    value: { digest: mockDigest },
    writable: true,
    configurable: true,
  });
} else {
  global.crypto = {
    subtle: { digest: mockDigest },
  };
}

// Mock for Tampermonkey GM functions
global.GM_addElement = vi.fn();
global.GM_deleteValue = vi.fn(() => Promise.resolve());
global.GM_download = vi.fn();
global.GM_getValue = vi.fn((key, defaultValue) => defaultValue);
global.GM_listValues = vi.fn(() => Promise.resolve([]));
global.GM_log = vi.fn();
global.GM_registerMenuCommand = vi.fn();
global.GM_setValue = vi.fn();
global.GM_xmlhttpRequest = vi.fn();

// Mock for sessionStorage
class MockStorage {
  constructor() {
    this.store = {};
    this.length = 0;

    // Make methods mock functions so they can be mocked
    this.key = vi.fn((n) => Object.keys(this.store)[n] || null);
    this.getItem = vi.fn((key) => this.store[key] || null);
    this.setItem = vi.fn((key, value) => {
      this.store[key] = String(value);
      this.length = Object.keys(this.store).length;
    });
    this.removeItem = vi.fn((key) => {
      delete this.store[key];
      this.length = Object.keys(this.store).length;
    });
    this.clear = vi.fn(() => {
      this.store = {};
      this.length = 0;
    });
  }
}

// Set up mocked DOM elements and localStorage
beforeEach(() => {
  // Mock sessionStorage. The jsdom environment exposes it as a getter-only
  // global, so it has to be redefined rather than assigned.
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MockStorage(),
    configurable: true,
    writable: true,
  });

  // Mock DOM elements
  document.body.innerHTML = '<div></div>';
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
