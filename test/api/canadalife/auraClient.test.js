/**
 * Canada Life API — Aura transport, payload construction and error detection
 */

import {
  makeAuraApiCall,
  buildApexActionPayload,
  CanadaLifeApiError,
  CanadaLifeTokenExpiredError,
} from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { debugLog } from '../../../src/core/utils';
import toast from '../../../src/ui/toast';
import { installCanadaLifeTestGlobals, readAuraRequest } from './harness';
import {
  buildLicenseExceptionResponse,
  buildActivityReportFailureResponse,
  mockFetchResponse,
  wrapAuraError,
  wrapAuraSuccess,
} from './fixtures';

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

const { localStorageMock } = installCanadaLifeTestGlobals();

const mockPayload = buildApexActionPayload({
  id: '123;a',
  classname: 'TestController',
  method: 'testMethod',
  params: { test: 'data' },
});

describe('Canada Life API - buildApexActionPayload', () => {
  test('builds a non-namespaced action by default', () => {
    const payload = buildApexActionPayload({
      id: '141;a',
      classname: 'MclawGrsaActivityPlansController',
      method: 'getPlanSelectionScreenData',
      params: { adminSystemId: 'ENC_X', language: 'en' },
    });

    expect(payload).toEqual({
      actions: [{
        id: '141;a',
        descriptor: 'aura://ApexActionController/ACTION$execute',
        callingDescriptor: 'UNKNOWN',
        params: {
          namespace: '',
          classname: 'MclawGrsaActivityPlansController',
          method: 'getPlanSelectionScreenData',
          params: { adminSystemId: 'ENC_X', language: 'en' },
          cacheable: false,
          isContinuation: false,
        },
      }],
    });
  });

  test('omits the params key entirely for zero-argument methods', () => {
    const payload = buildApexActionPayload({
      id: '99;a',
      classname: 'IMSCommunityHelperSfiLwc',
      method: 'getSponsorInfo',
    });

    expect(payload.actions[0].params).not.toHaveProperty('params');
    expect(payload.actions[0].params.classname).toBe('IMSCommunityHelperSfiLwc');
  });

  test('supports an explicit namespace for legacy controllers', () => {
    const payload = buildApexActionPayload({
      id: '1;a',
      classname: 'BusinessProcessDisplayController',
      method: 'GenericInvoke2NoCont',
      params: {},
      namespace: 'vlocity_ins',
    });

    expect(payload.actions[0].params.namespace).toBe('vlocity_ins');
  });
});

describe('Canada Life API - makeAuraApiCall transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('posts form-encoded fields to the Aura endpoint', async () => {
    const body = wrapAuraSuccess({ ok: true });
    global.fetch.mockResolvedValue(mockFetchResponse(body));

    const result = await makeAuraApiCall(mockPayload);

    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://my.canadalife.com/s/sfsites/aura?r=13&aura.ApexAction.execute=1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          cookie: 'mock-cookie=value; another-cookie=another-value',
        }),
      }),
    );

    const request = readAuraRequest();
    expect(request.token).toBe('valid-aura-token');
    expect(request.pageURI).toBe('/s/activity-reports');
    expect(request.message).toEqual(mockPayload);
  });

  test('unwraps /*-secure- wrapped responses', async () => {
    const body = wrapAuraSuccess({ ok: true });
    global.fetch.mockResolvedValue(mockFetchResponse(body, true));

    await expect(makeAuraApiCall(mockPayload)).resolves.toEqual(body);
    expect(debugLog).toHaveBeenCalledWith('Cleaned response from /*-secure- wrapper');
  });

  test('unwraps generic /* */ wrapped responses', async () => {
    const inner = { success: true, data: 'test' };
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json', entries: () => [] },
      text: () => Promise.resolve(`/*${JSON.stringify(inner)}*/`),
    });

    await expect(makeAuraApiCall(mockPayload)).resolves.toEqual(inner);
    expect(debugLog).toHaveBeenCalledWith('Cleaned response from /* */ wrapper');
  });

  test('throws when no Aura token is available', async () => {
    stateManager.getState.mockReturnValue({ auth: { canadalife: { token: null } } });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('No Aura token found');
  });

  test('throws on HTTP failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null, entries: () => [] },
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('Aura API call failed: 500 Internal Server Error');
  });

  test('throws when the body is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html', entries: () => [] },
      text: () => Promise.resolve('invalid json'),
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('Failed to parse API response as JSON');
  });

  test('forwards the abort signal to fetch', async () => {
    const { signal } = new AbortController();
    global.fetch.mockRejectedValue(new Error('AbortError'));

    await expect(makeAuraApiCall(mockPayload, { signal })).rejects.toThrow('AbortError');
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }));
  });
});

describe('Canada Life API - nested returnValue extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('unwraps an object returnValue (current Mclaw controllers)', async () => {
    const nested = { activityReportMap: { success: true, data: { Summary: {} } }, isSuccess: true };
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess(nested)));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .resolves.toEqual(nested);
  });

  test('unwraps a JSON-string returnValue (legacy Vlocity controllers)', async () => {
    const nested = { nested: true, value: 123 };
    global.fetch.mockResolvedValue(mockFetchResponse({
      actions: [{ returnValue: { returnValue: JSON.stringify(nested) } }],
    }));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .resolves.toEqual(nested);
    expect(debugLog).toHaveBeenCalledWith('Extracted nested response data:', nested);
  });

  test('throws a typed error when the envelope has no returnValue', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({ actions: [{ returnValue: {} }] }));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .rejects.toThrow(CanadaLifeApiError);
  });
});

describe('Canada Life API - Apex action error detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Regression test: this is the exact failure that broke the integration when
  // Canada Life dropped the Vlocity Insurance package licence. Previously the
  // errored action was ignored and the call failed later with the misleading
  // "No return value in Canada Life API response".
  test('surfaces System.LicenseException with an actionable message', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .rejects.toThrow(CanadaLifeApiError);

    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('Canada Life changed their portal API'),
      'error',
    );
    expect(toast.show).not.toHaveBeenCalledWith(
      expect.stringContaining('No return value'),
      'error',
    );
  });

  test('includes the raw Apex message in the license error details', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(/requires a license to use/);
  });

  test('does not blame a stale fwuid when a concrete Apex error is present', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);

    // COOSE itself is still reported...
    expect(debugLog).toHaveBeenCalledWith(
      'COOSE (Client Out Of Sync Error) detected in response:',
      expect.objectContaining({ id: 'COOSE' }),
    );
    // ...but the misleading fwuid hint is suppressed
    expect(debugLog).not.toHaveBeenCalledWith(
      expect.stringContaining('The Salesforce framework version (fwuid) may be out of sync'),
    );
  });

  test('reports a generic Apex exception with its type', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraError({
      exceptionType: 'System.NullPointerException',
      message: 'Attempt to de-reference a null object',
    })));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(/System.NullPointerException/);
    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(/de-reference a null object/);
  });

  test('treats an invalid session as a recoverable token error and retries', async () => {
    global.fetch
      .mockResolvedValueOnce(mockFetchResponse({
        actions: [{
          id: '1;a',
          state: 'ERROR',
          exceptionEvent: true,
          error: [{
            message: 'Your session has expired',
            event: { descriptor: 'markup://aura:invalidSession' },
          }],
        }],
      }))
      .mockResolvedValueOnce(mockFetchResponse(wrapAuraSuccess({ ok: true })));

    localStorageMock.getItem.mockReturnValue('fresh-token');

    await expect(makeAuraApiCall(mockPayload)).resolves.toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith('Token expired, retrying with fresh token...', 'debug');
  });

  test('treats an invalid session with no fresh token as unrecoverable', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      actions: [{
        id: '1;a',
        state: 'ERROR',
        exceptionEvent: true,
        error: [{ message: 'Your session has expired' }],
      }],
    }));

    localStorageMock.getItem.mockReturnValue(null);

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeTokenExpiredError);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Please refresh the page'), 'error');
  });
});

describe('Canada Life API - envelope failure flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // The one-year date range limit is enforced server-side and arrives as
  // success:false with HTTP 200, not as an Apex exception.
  test('surfaces the server message for success:false envelopes', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportFailureResponse()));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .rejects.toThrow(/not more than a year/);
  });

  test('reports a fallback message when success:false carries no reason', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(
      wrapAuraSuccess({ activityReportMap: { success: false }, isSuccess: false }),
    ));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .rejects.toThrow(/gave no reason/);
  });

  test('does not treat error:"OK" as a failure', async () => {
    const nested = { getSponsorInfo: { GRS_ParticId__c: 'ENC_X' }, error: 'OK' };
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess(nested)));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .resolves.toEqual(nested);
  });

  test('ignores success:true envelopes', async () => {
    const nested = { activityReportMap: { success: true, data: {} }, isSuccess: true };
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess(nested)));

    await expect(makeAuraApiCall(mockPayload, { extractNestedResponse: true }))
      .resolves.toEqual(nested);
  });
});

describe('Canada Life API - legacy IPResult error detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('retries when IPResult reports an expired token and a fresh one exists', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
        result: { errors: [{ errorId: '004', httpCode: '401', detail: 'Access token expired' }] },
      },
    };

    global.fetch
      .mockResolvedValueOnce(mockFetchResponse(errorResponse))
      .mockResolvedValueOnce(mockFetchResponse({ success: true }));

    localStorageMock.getItem.mockReturnValue('fresh-token');

    await expect(makeAuraApiCall(mockPayload)).resolves.toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith('Token expired, retrying with fresh token...', 'debug');
  });

  test('reports an unrecoverable token error when no fresh token exists', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      IPResult: {
        activityReportsHasApiFailure: true,
        result: { errors: [{ errorId: '004', httpCode: '401', detail: 'Access token expired' }] },
      },
    }));

    localStorageMock.getItem.mockReturnValue(null);

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeTokenExpiredError);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Please refresh the page'), 'error');
  });

  test('reports non-token IPResult errors', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      IPResult: {
        activityReportsHasApiFailure: true,
        result: { errors: [{ errorId: '500', httpCode: '500', detail: 'Internal server error' }] },
      },
    }));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Internal server error'), 'error');
  });

  test('detects a failure flag with no error details', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      IPResult: { memberPlansHasAPIFailure: true, error: 'OK' },
    }));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(/memberPlansHasAPIFailure/);
  });

  test('lists every failure flag that is set', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      IPResult: { activityReportsHasApiFailure: true, memberPlansHasAPIFailure: true },
    }));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining('API failure flag(s) detected'),
      expect.any(Object),
    );
  });

  test('exposes the failure flags in the error details', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      IPResult: { memberPlansHasAPIFailure: true },
    }));

    await expect(makeAuraApiCall(mockPayload)).rejects.toMatchObject({
      errorDetails: { memberPlansHasAPIFailure: true },
    });
  });

  test('ignores failure flags that are false', async () => {
    const body = {
      IPResult: {
        activityReportsHasApiFailure: false,
        memberPlansHasAPIFailure: false,
        MemberPlans: [{ agreementId: '123' }],
      },
    };
    global.fetch.mockResolvedValue(mockFetchResponse(body));

    const result = await makeAuraApiCall(mockPayload);
    expect(result.IPResult.MemberPlans).toBeDefined();
  });

  test('logs the stale-fwuid hint for COOSE without an Apex error', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse({
      actions: [
        {
          id: '164;a',
          state: 'SUCCESS',
          returnValue: { returnValue: '{"IPResult":{"memberPlansHasAPIFailure":true}}' },
        },
        { id: 'COOSE', state: 'warning', returnValue: 'This page has changes since the last refresh.' },
      ],
    }));

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);
    expect(debugLog).toHaveBeenCalledWith(
      'COOSE (Client Out Of Sync Error) detected in response:',
      expect.objectContaining({ id: 'COOSE' }),
    );
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining('The Salesforce framework version (fwuid) may be out of sync'),
    );
  });
});
