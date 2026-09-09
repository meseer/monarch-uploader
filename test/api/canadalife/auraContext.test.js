/**
 * Canada Life API — aura.context resolution
 */

import {
  getAuraContext,
  harvestAuraContext,
  clearHarvestedAuraContext,
  makeAuraApiCall,
  buildApexActionPayload,
} from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { debugLog } from '../../../src/core/utils';
import { installCanadaLifeTestGlobals, readAuraRequest } from './harness';
import { SERVER_FWUID, mockFetchResponse, wrapAuraSuccess } from './fixtures';

jest.mock('../../../src/core/state', () => {
  const { buildStateMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/core/utils', () => {
  const { buildUtilsMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/ui/toast', () => {
  const { buildToastMock: build } = jest.requireActual('./harness');
  return build();
});

installCanadaLifeTestGlobals();

describe('Canada Life API - getAuraContext from $A runtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHarvestedAuraContext();
    delete global.window.$A;
    delete globalThis.unsafeWindow;
  });

  afterEach(() => {
    delete global.window.$A;
    delete globalThis.unsafeWindow;
  });

  test('uses encodeForServer when it returns a string', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue('{"mode":"PROD","fwuid":"dynamic-fwuid-123"}'),
      }),
    };

    expect(getAuraContext()).toBe('{"mode":"PROD","fwuid":"dynamic-fwuid-123"}');
    expect(debugLog).toHaveBeenCalledWith('Extracted aura.context via $A.getContext().encodeForServer()');
  });

  test('uses encodeForServer when it returns an object', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue({ mode: 'PROD', fwuid: 'obj-fwuid' }),
      }),
    };

    const parsed = JSON.parse(getAuraContext());

    expect(parsed.fwuid).toBe('obj-fwuid');
    expect(parsed.mode).toBe('PROD');
  });

  test('builds the context manually from context.fwuid', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        fwuid: 'manual-fwuid-456',
        mode: 'PROD',
        loaded: { 'APPLICATION@markup://siteforce:communityApp': 'test-hash' },
      }),
    };

    const parsed = JSON.parse(getAuraContext());

    expect(parsed.fwuid).toBe('manual-fwuid-456');
    expect(parsed.app).toBe('siteforce:communityApp');
    expect(parsed.loaded).toEqual({ 'APPLICATION@markup://siteforce:communityApp': 'test-hash' });
    expect(debugLog).toHaveBeenCalledWith(
      'Built aura.context manually from $A.getContext() properties',
      { fwuid: 'manual-fwuid-456' },
    );
  });

  test('falls back to getEncodedFwuid() when fwuid is absent', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        getEncodedFwuid: jest.fn().mockReturnValue('encoded-fwuid-789'),
        mode: 'PROD',
        loaded: {},
      }),
    };

    expect(JSON.parse(getAuraContext()).fwuid).toBe('encoded-fwuid-789');
  });

  // Userscripts run in a sandbox in some managers, so window.$A is undefined
  // while the real page object is reachable through unsafeWindow.
  test('resolves $A through unsafeWindow when window.$A is missing', () => {
    globalThis.unsafeWindow = {
      $A: {
        getContext: jest.fn().mockReturnValue({
          encodeForServer: jest.fn().mockReturnValue('{"mode":"PROD","fwuid":"unsafe-fwuid"}'),
        }),
      },
    };

    expect(JSON.parse(getAuraContext()).fwuid).toBe('unsafe-fwuid');
    expect(debugLog).toHaveBeenCalledWith('Resolved $A via unsafeWindow (sandboxed userscript context)');
  });

  test('prefers window.$A over unsafeWindow when both exist', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue('{"fwuid":"window-fwuid"}'),
      }),
    };
    globalThis.unsafeWindow = {
      $A: {
        getContext: jest.fn().mockReturnValue({
          encodeForServer: jest.fn().mockReturnValue('{"fwuid":"unsafe-fwuid"}'),
        }),
      },
    };

    expect(JSON.parse(getAuraContext()).fwuid).toBe('window-fwuid');
  });

  test('falls back to the hardcoded context when $A is unavailable', () => {
    const parsed = JSON.parse(getAuraContext());

    expect(parsed.mode).toBe('PROD');
    expect(parsed.fwuid).toBeTruthy();
    expect(parsed.app).toBe('siteforce:communityApp');
    expect(debugLog).toHaveBeenCalledWith('WARNING: Using hardcoded fallback aura.context — this may become stale');
  });

  test('falls back gracefully when $A.getContext throws', () => {
    global.window.$A = {
      getContext: jest.fn().mockImplementation(() => {
        throw new Error('Aura framework not initialized');
      }),
    };

    expect(JSON.parse(getAuraContext()).fwuid).toBeTruthy();
    expect(debugLog).toHaveBeenCalledWith(
      'Error extracting dynamic aura.context, using fallback:',
      expect.any(Error),
    );
  });

  test('falls back when encodeForServer returns null and no fwuid exists', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue(null),
      }),
    };

    expect(JSON.parse(getAuraContext()).fwuid).toBeTruthy();
    expect(debugLog).toHaveBeenCalledWith('WARNING: Using hardcoded fallback aura.context — this may become stale');
  });
});

describe('Canada Life API - harvesting fwuid from responses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHarvestedAuraContext();
    delete global.window.$A;
    delete globalThis.unsafeWindow;
  });

  test('reuses a harvested fwuid instead of the stale hardcoded fallback', () => {
    harvestAuraContext({
      context: { fwuid: SERVER_FWUID, loaded: { app: 'hash' } },
    });

    const parsed = JSON.parse(getAuraContext());

    expect(parsed.fwuid).toBe(SERVER_FWUID);
    expect(parsed.loaded).toEqual({ app: 'hash' });
    expect(debugLog).toHaveBeenCalledWith(
      'Using aura.context fwuid harvested from a previous response',
      { fwuid: SERVER_FWUID },
    );
  });

  test('ignores responses without a usable fwuid', () => {
    harvestAuraContext({ context: {} });
    harvestAuraContext({ context: { fwuid: '' } });
    harvestAuraContext(null);
    harvestAuraContext('not an object');

    expect(JSON.parse(getAuraContext()).fwuid).not.toBe(SERVER_FWUID);
  });

  test('clearHarvestedAuraContext drops the cached value', () => {
    harvestAuraContext({ context: { fwuid: SERVER_FWUID } });
    expect(JSON.parse(getAuraContext()).fwuid).toBe(SERVER_FWUID);

    clearHarvestedAuraContext();
    expect(JSON.parse(getAuraContext()).fwuid).not.toBe(SERVER_FWUID);
  });

  // A stale fwuid is what produces COOSE warnings and silently failing actions,
  // so the server's own value must be adopted for subsequent requests.
  test('a real API call harvests the fwuid and reuses it on the next request', async () => {
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });

    const payload = buildApexActionPayload({
      id: '1;a',
      classname: 'TestController',
      method: 'test',
    });

    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({ ok: true })));

    await makeAuraApiCall(payload);
    expect(readAuraRequest(0).context.fwuid).not.toBe(SERVER_FWUID);

    await makeAuraApiCall(payload);
    expect(readAuraRequest(1).context.fwuid).toBe(SERVER_FWUID);
  });
});