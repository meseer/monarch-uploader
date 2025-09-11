// Mock for Tampermonkey GM functions
global.GM_addElement = jest.fn();
global.GM_deleteValue = jest.fn();
global.GM_download = jest.fn();
global.GM_getValue = jest.fn((key, defaultValue) => defaultValue);
global.GM_listValues = jest.fn(() => []);
global.GM_log = jest.fn();
global.GM_registerMenuCommand = jest.fn();
global.GM_setValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

// Mock for sessionStorage
class MockStorage {
  constructor() {
    this.store = {};
    this.length = 0;
  }

  key(n) {
    return Object.keys(this.store)[n];
  }

  getItem(key) {
    return this.store[key] || null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
    this.length = Object.keys(this.store).length;
  }

  removeItem(key) {
    delete this.store[key];
    this.length = Object.keys(this.store).length;
  }

  clear() {
    this.store = {};
    this.length = 0;
  }
}

// Set up mocked DOM elements and localStorage
beforeEach(() => {
  // Mock sessionStorage
  global.sessionStorage = new MockStorage();
  
  // Mock DOM elements
  document.body.innerHTML = '<div></div>';
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});
