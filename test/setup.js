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

// Store original location for restoration
const originalLocation = window.location;

// Set up mocked DOM elements and localStorage
beforeEach(() => {
  // Mock sessionStorage
  global.sessionStorage = new MockStorage();
  
  // Mock DOM elements
  document.body.innerHTML = '<div></div>';
  
  // Clean up window.location if it was mocked
  if (window.location !== originalLocation) {
    delete window.location;
    window.location = originalLocation;
  }
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  
  // Restore original location
  if (window.location !== originalLocation) {
    delete window.location;
    window.location = originalLocation;
  }
});
