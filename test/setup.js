// Mock for TextEncoder (used by Web Crypto API)
const { TextEncoder } = require('util');

global.TextEncoder = TextEncoder;

// Mock for Web Crypto API (crypto.subtle)
// JSDOM has a crypto object but without subtle, so we need to add it
const mockDigest = jest.fn(async (algorithm, data) => {
  // Create a deterministic hash based on the input data
  // This allows consistent hashing in tests
  const dataArray = new Uint8Array(data);
  const hash = new ArrayBuffer(32);
  const hashView = new Uint8Array(hash);

  // Simple deterministic hash for testing (not cryptographically secure)
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum = (sum * 31 + dataArray[i]) >>> 0;
  }

  // Fill hash buffer with deterministic values
  for (let i = 0; i < 32; i++) {
    hashView[i] = (sum >> (i % 4) * 8) & 0xff;
    sum = (sum * 31 + i) >>> 0;
  }

  return hash;
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
global.GM_addElement = jest.fn();
global.GM_deleteValue = jest.fn(() => Promise.resolve());
global.GM_download = jest.fn();
global.GM_getValue = jest.fn((key, defaultValue) => defaultValue);
global.GM_listValues = jest.fn(() => Promise.resolve([]));
global.GM_log = jest.fn();
global.GM_registerMenuCommand = jest.fn();
global.GM_setValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

// Mock for sessionStorage
class MockStorage {
  constructor() {
    this.store = {};
    this.length = 0;

    // Make methods jest functions so they can be mocked
    this.key = jest.fn((n) => Object.keys(this.store)[n] || null);
    this.getItem = jest.fn((key) => this.store[key] || null);
    this.setItem = jest.fn((key, value) => {
      this.store[key] = String(value);
      this.length = Object.keys(this.store).length;
    });
    this.removeItem = jest.fn((key) => {
      delete this.store[key];
      this.length = Object.keys(this.store).length;
    });
    this.clear = jest.fn(() => {
      this.store = {};
      this.length = 0;
    });
  }
}

// Location mocking utility using Jest spies - works reliably with JSDOM
global.mockLocation = (locationProps) => {
  // Create properties with defaults
  const href = locationProps.href || 'http://localhost/';
  const url = new URL(href);

  // Create new location object with all required properties using URL parsing
  const mockLocationObj = {
    href,
    hostname: locationProps.hostname || url.hostname,
    pathname: locationProps.pathname || url.pathname,
    search: locationProps.search || url.search,
    hash: locationProps.hash || url.hash,
    origin: locationProps.origin || url.origin,
    protocol: locationProps.protocol || url.protocol,
    host: locationProps.host || url.host,
    port: locationProps.port || url.port,

    // Add methods that some code might expect
    toString: () => href,
    valueOf: () => href,

    // Add any additional properties
    ...locationProps,
  };

  // Store the mock for later access and cleanup
  global.mockLocationSpy = mockLocationObj;

  // Store original spies for cleanup
  if (!global.locationSpies) {
    global.locationSpies = {};
  }

  // Use Jest spies to mock individual location properties
  Object.keys(mockLocationObj).forEach((key) => {
    if (key !== 'toString' && key !== 'valueOf') {
      try {
        // Create or update spy for this property
        if (global.locationSpies[key]) {
          global.locationSpies[key].mockReturnValue(mockLocationObj[key]);
        } else {
          global.locationSpies[key] = jest.spyOn(window.location, key, 'get').mockReturnValue(mockLocationObj[key]);
        }
      } catch (e) {
        // If we can't spy on the property, try a direct approach
        try {
          Object.defineProperty(window.location, key, {
            get: () => mockLocationObj[key],
            configurable: true,
          });
        } catch (e2) {
          // Skip properties we can't mock
        }
      }
    }
  });

  return mockLocationObj;
};

// Restore original location utility
global.restoreLocation = () => {
  try {
    // Clear any spy
    if (global.mockLocationSpy) {
      delete global.mockLocationSpy;
    }

    // Restore all location property spies
    if (global.locationSpies) {
      Object.keys(global.locationSpies).forEach((key) => {
        try {
          if (global.locationSpies[key]) {
            global.locationSpies[key].mockRestore();
            delete global.locationSpies[key];
          }
        } catch (err) {
          // Skip spies we can't restore
        }
      });
    }
  } catch (e) {
    console.warn('Could not restore location spies:', e);
  }
};

// Set up mocked DOM elements and localStorage
beforeEach(() => {
  // Mock sessionStorage
  global.sessionStorage = new MockStorage();

  // Mock DOM elements
  document.body.innerHTML = '<div></div>';

  // Restore original location before each test
  global.restoreLocation();
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';

  // Restore original location after each test
  global.restoreLocation();
});
