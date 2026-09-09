/**
 * Low-level Aura (Salesforce Experience Cloud) transport for Canada Life.
 *
 * Canada Life's member portal exposes its data through Aura's
 * `ApexActionController`. Requests are form-encoded POSTs carrying four fields:
 * `message` (the action payload), `aura.context`, `aura.pageURI` and
 * `aura.token`.
 *
 * @module api/canadalife/auraClient
 */

import { debugLog } from '../../core/utils';
import stateManager from '../../core/state';
import toast from '../../ui/toast';
import { CanadaLifeApiError, CanadaLifeTokenExpiredError } from './errors';
import { extractCookies } from './auth';
import { getAuraContext, harvestAuraContext } from './auraContext';
import { checkApiResponseForErrors } from './responseErrors';
import type { AuraApiCallOptions } from './types';

/** Aura endpoint for Apex action execution */
const AURA_ENDPOINT = 'https://my.canadalife.com/s/sfsites/aura?r=13&aura.ApexAction.execute=1';

/** Page URI sent with every request (must be a real community page) */
const AURA_PAGE_URI = '/s/activity-reports';

/**
 * Build an `aura://ApexActionController/ACTION$execute` payload.
 *
 * Canada Life's current controllers are non-namespaced (`namespace: ''`); the
 * retired Vlocity ones required `namespace: 'vlocity_ins'`.
 *
 * @param options - Action descriptor
 * @param options.id - Aura action id (any unique `N;a` string)
 * @param options.classname - Apex controller class name
 * @param options.method - Apex method name
 * @param options.params - Method parameters (omitted entirely when undefined)
 * @param options.namespace - Apex namespace (defaults to '' for Mclaw controllers)
 * @returns Payload object for the `message` form field
 */
export function buildApexActionPayload(options: {
  id: string;
  classname: string;
  method: string;
  params?: Record<string, unknown>;
  namespace?: string;
}): Record<string, unknown> {
  const {
    id, classname, method, params, namespace = '',
  } = options;

  const actionParams: Record<string, unknown> = {
    namespace,
    classname,
    method,
    cacheable: false,
    isContinuation: false,
  };

  // Some methods (e.g. IMSCommunityHelperSfiLwc.getSponsorInfo) take no
  // arguments and must not receive a `params` key at all.
  if (params !== undefined) {
    actionParams.params = params;
  }

  return {
    actions: [{
      id,
      descriptor: 'aura://ApexActionController/ACTION$execute',
      callingDescriptor: 'UNKNOWN',
      params: actionParams,
    }],
  };
}

/**
 * Strip the comment wrapper Salesforce sometimes applies to Aura responses.
 * @param rawResponse - Raw response body
 * @returns Bare JSON string
 */
function stripResponseWrapper(rawResponse: string): string {
  if (rawResponse.startsWith('/*-secure-')) {
    const startIndex = rawResponse.indexOf('\n') + 1;
    const endIndex = rawResponse.lastIndexOf('*/');
    if (startIndex > 0 && endIndex > startIndex) {
      debugLog('Cleaned response from /*-secure- wrapper');
      return rawResponse.substring(startIndex, endIndex);
    }
    return rawResponse;
  }

  if (rawResponse.startsWith('/*') && rawResponse.endsWith('*/')) {
    debugLog('Cleaned response from /* */ wrapper');
    return rawResponse.slice(2, -2);
  }

  return rawResponse;
}

/**
 * Parse an Aura response body, tolerating the optional comment wrapper.
 * @param rawResponse - Raw response body
 * @returns Parsed response object
 * @throws If neither the cleaned nor the raw body is valid JSON
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAuraResponse(rawResponse: string): any {
  const cleanResponse = stripResponseWrapper(rawResponse);

  debugLog('Cleaned response preview:', {
    originalLength: rawResponse.length,
    cleanedLength: cleanResponse.length,
    cleanedStart: cleanResponse.substring(0, 200),
  });

  try {
    const parsed = JSON.parse(cleanResponse);
    debugLog('Successfully parsed JSON response');
    return parsed;
  } catch (parseError) {
    debugLog('JSON parse failed on cleaned response:', {
      error: (parseError as Error).message,
      cleanedResponsePreview: cleanResponse.substring(0, 500),
    });

    try {
      const parsed = JSON.parse(rawResponse);
      debugLog('Successfully parsed original raw response');
      return parsed;
    } catch (originalParseError) {
      debugLog('Failed to parse both cleaned and raw responses:', {
        cleanedError: (parseError as Error).message,
        originalError: (originalParseError as Error).message,
      });
      throw new Error(
        `Failed to parse API response as JSON. Original error: ${(originalParseError as Error).message}`,
        { cause: originalParseError },
      );
    }
  }
}

/**
 * Unwrap `actions[0].returnValue.returnValue`.
 *
 * The current Mclaw controllers return this as a plain object, while the
 * retired Vlocity controllers returned a JSON string. Both are supported.
 *
 * @param responseData - Parsed Aura response
 * @returns The inner payload
 * @throws If the response envelope or the inner value is missing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNestedReturnValue(responseData: any): any {
  if (!responseData?.actions?.[0]?.returnValue) {
    throw new CanadaLifeApiError('Invalid response format from Canada Life API', responseData);
  }

  const { returnValue } = responseData.actions[0].returnValue;
  if (!returnValue) {
    throw new CanadaLifeApiError('No return value in Canada Life API response', responseData);
  }

  const nestedData = typeof returnValue === 'string' ? JSON.parse(returnValue) : returnValue;
  debugLog('Extracted nested response data:', nestedData);

  return nestedData;
}

/**
 * Show the appropriate toast for a Canada Life error, if any.
 * @param error - Error thrown during response validation
 */
function notifyUserOfError(error: unknown): void {
  if (error instanceof CanadaLifeTokenExpiredError && !error.recoverable) {
    toast.show(error.message, 'error');
  } else if (error instanceof CanadaLifeApiError) {
    toast.show(error.message, 'error');
  }
}

/**
 * Send the HTTP request for an Aura action.
 * @param payload - Payload for the `message` form field
 * @param auraToken - Current Aura session token
 * @param signal - Optional abort signal
 * @returns Raw response body
 * @throws If the HTTP request fails
 */
async function postAuraRequest(
  payload: Record<string, unknown>,
  auraToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new URLSearchParams();
  formData.append('message', JSON.stringify(payload));
  formData.append('aura.context', getAuraContext());
  formData.append('aura.pageURI', AURA_PAGE_URI);
  formData.append('aura.token', auraToken);

  const response = await fetch(AURA_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: '*/*',
      adrum: 'isAjax:true',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: 'https://my.canadalife.com',
      cookie: extractCookies(),
    },
    body: formData.toString(),
    signal,
  });

  debugLog('Response status details:', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    url: response.url,
  });

  if (!response.ok) {
    throw new Error(`Aura API call failed: ${response.status} ${response.statusText}`);
  }

  const rawResponse = await response.text();

  debugLog('Raw response analysis:', {
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    responseSize: rawResponse.length,
    responseStart: rawResponse.substring(0, 300),
    responseEnd: rawResponse.substring(Math.max(0, rawResponse.length - 200)),
    startsWithComment: rawResponse.startsWith('/*'),
    endsWithComment: rawResponse.endsWith('*/'),
    headers: Object.fromEntries(response.headers.entries()),
  });

  return rawResponse;
}

/**
 * Make an Aura API call to Canada Life, with error detection and a single
 * automatic retry when the session token has been refreshed mid-flight.
 *
 * @param payload - The payload object to send as the `message` field
 * @param options - Call options
 * @returns Parsed API response, or the unwrapped nested payload when
 *          `extractNestedResponse` is set
 * @throws `CanadaLifeTokenExpiredError` / `CanadaLifeApiError` on API failures
 */
export async function makeAuraApiCall(
  payload: Record<string, unknown>,
  options: AuraApiCallOptions = {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const isRetry = options.isRetry || false;

  try {
    const auraToken = stateManager.getState().auth.canadalife.token;

    if (!auraToken) {
      throw new Error('No Aura token found. Please ensure you are logged in to Canada Life.');
    }

    debugLog('Making Aura API call to Canada Life', {
      endpoint: AURA_ENDPOINT,
      payload,
      isRetry,
      tokenPreview: `${auraToken.substring(0, 10)}...`,
    });

    const rawResponse = await postAuraRequest(payload, auraToken, options.signal);
    const responseData = parseAuraResponse(rawResponse);

    debugLog('Aura API response parsed successfully:', responseData);

    // Cache the server's own fwuid so subsequent calls stay in sync
    harvestAuraContext(responseData);

    // Validate the outer envelope, then optionally the unwrapped payload
    const validate = (data: unknown): void => {
      checkApiResponseForErrors(data, auraToken);
    };

    try {
      validate(responseData);

      if (!options.extractNestedResponse) {
        return responseData;
      }

      const nestedData = extractNestedReturnValue(responseData);
      validate(nestedData);
      return nestedData;
    } catch (error) {
      if (error instanceof CanadaLifeTokenExpiredError && !isRetry && error.recoverable) {
        debugLog('Token expired, attempting retry with fresh token');
        toast.show('Token expired, retrying with fresh token...', 'debug');
        return await makeAuraApiCall(payload, { ...options, isRetry: true });
      }

      notifyUserOfError(error);
      throw error;
    }
  } catch (error) {
    debugLog('Error making Aura API call:', error);

    if (!isRetry && error instanceof CanadaLifeTokenExpiredError) {
      debugLog('Token error on initial attempt, retry logic will handle if token is refreshable');
    } else if (isRetry) {
      debugLog('Error occurred during retry attempt, no further retries will be attempted');
    }

    throw error;
  }
}