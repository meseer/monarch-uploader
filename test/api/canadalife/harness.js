/**
 * Shared test harness for Canada Life API tests.
 *
 * Installs the browser and Tampermonkey globals the API layer depends on.
 * Note that `jest.mock()` calls must remain in each test file because Jest
 * hoists them above imports.
 */

/**
 * Install the global mocks the Canada Life API layer needs.
 *
 * @returns {Object} Handles for the installed mocks
 */
export function installCanadaLifeTestGlobals() {
  const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    clear: jest.fn(),
  };
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });

  if (!global.document) {
    Object.defineProperty(global, 'document', {
      value: {},
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(global.document, 'cookie', {
    value: 'mock-cookie=value; another-cookie=another-value',
    writable: true,
    configurable: true,
  });

  if (!global.window) {
    Object.defineProperty(global, 'window', {
      value: { addEventListener: jest.fn() },
      writable: true,
      configurable: true,
    });
  } else {
    global.window.addEventListener = jest.fn();
  }

  global.GM_getValue = jest.fn();
  global.GM_setValue = jest.fn();
  global.GM_deleteValue = jest.fn();
  global.setInterval = jest.fn();
  global.fetch = jest.fn();

  return { localStorageMock };
}

/**
 * Standard state manager mock factory for `jest.mock('../../../src/core/state')`.
 * @returns {Object} Mocked module shape
 */
export function buildStateMock() {
  return {
    __esModule: true,
    default: {
      getState: jest.fn().mockReturnValue({
        auth: { canadalife: { token: 'mock-aura-token' } },
      }),
      setCanadaLifeAuth: jest.fn(),
    },
  };
}

/**
 * Standard utils mock factory for `jest.mock('../../../src/core/utils')`.
 * Only the functions the Canada Life API layer uses are provided.
 * @returns {Object} Mocked module shape
 */
export function buildUtilsMock() {
  return {
    debugLog: jest.fn(),
    parseLocalDate: jest.fn((dateString) => {
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(year, month - 1, day);
    }),
    formatDate: jest.fn((date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }),
  };
}

/**
 * Standard toast mock factory for `jest.mock('../../../src/ui/toast')`.
 * @returns {Object} Mocked module shape
 */
export function buildToastMock() {
  return {
    __esModule: true,
    default: { show: jest.fn() },
  };
}

/**
 * Parse the form fields of the Nth `fetch` call made by the API layer.
 * @param {number} callIndex - Index into `global.fetch.mock.calls`
 * @returns {Object} Decoded `message`, `aura.context` and `aura.token` values
 */
export function readAuraRequest(callIndex = 0) {
  const [, options] = global.fetch.mock.calls[callIndex];
  const params = new URLSearchParams(options.body);

  return {
    message: JSON.parse(params.get('message')),
    context: JSON.parse(params.get('aura.context')),
    token: params.get('aura.token'),
    pageURI: params.get('aura.pageURI'),
  };
}

/**
 * Extract the `params` block of the first action in a request payload.
 * @param {number} callIndex - Index into `global.fetch.mock.calls`
 * @returns {Object} The action's `params` object
 */
export function readActionParams(callIndex = 0) {
  return readAuraRequest(callIndex).message.actions[0].params;
}