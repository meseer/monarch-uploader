/**
 * Canada Life Aura response error detection.
 *
 * Canada Life reports failures in four different ways, all of which arrive with
 * HTTP 200:
 *
 * 1. **Aura action errors** — `actions[].state === 'ERROR'` with an `error[]`
 *    array holding an Apex `exceptionType` and `message`. This is how Apex
 *    exceptions (e.g. `System.LicenseException`) and expired sessions surface.
 * 2. **Envelope failure flags** — the Mclaw controllers wrap their payload in
 *    `{ isSuccess: boolean }` / `{ <map>: { success: boolean } }` and put the
 *    user-facing reason in a message field (e.g. the "not more than a year"
 *    date-range limit).
 * 3. **Legacy Vlocity `IPResult`** — `*HasApiFailure` flags plus
 *    `IPResult.result.errors[]`, used by the pre-2026 integration-procedure API.
 * 4. **COOSE** — a `warning` action indicating our `aura.context` `fwuid` is
 *    stale. Informational only; the actual request may still have succeeded.
 *
 * @module api/canadalife/responseErrors
 */

import { debugLog } from '../../core/utils';
import { CanadaLifeApiError, CanadaLifeTokenExpiredError } from './errors';
import { attemptTokenRefresh } from './auth';

/** Apex exception types that mean the portal API is no longer available to us */
const LICENSE_EXCEPTION_TYPES = ['System.LicenseException'];

/** Aura event descriptors / exception types that indicate an expired session */
const INVALID_SESSION_MARKERS = ['invalidSession', 'AuraHandledException.invalidSession'];

/** Message fields to search, in order, when reporting an envelope failure */
const MESSAGE_FIELDS = ['message', 'errorMessage', 'error', 'errorMsg'];

/**
 * Build the user-facing message for a `System.LicenseException`.
 *
 * This happens when Canada Life moves a portal feature off an AppExchange
 * package (or revokes the licence), making the Apex class we call unreachable.
 * It is not something the user can fix by re-authenticating, so say so.
 *
 * @param apexMessage - Raw Apex exception message
 * @returns Actionable message for the toast
 */
function formatLicenseExceptionMessage(apexMessage: string): string {
  return 'Canada Life changed their portal API and the endpoint this script uses is no longer '
    + 'available. A script update is required — please report this. '
    + `(Details: ${apexMessage})`;
}

/**
 * Throw the appropriate typed error for an expired Canada Life session,
 * retrying-capable if a fresh token is already in localStorage.
 *
 * @param message - Description of what expired
 * @param details - Raw error payload for debugging
 * @param currentToken - Token used by the failing request
 * @throws Always — `CanadaLifeTokenExpiredError`
 */
function throwTokenExpired(message: string, details: unknown, currentToken: string): never {
  const freshToken = attemptTokenRefresh(currentToken);

  const error = new CanadaLifeTokenExpiredError(
    freshToken
      ? `Token expired: ${message}. Retrying with fresh token.`
      : `Token expired: ${message}. Please refresh the page or log back into Canada Life.`,
    details,
  );

  if (!freshToken) {
    error.recoverable = false;
  }

  throw error;
}

/**
 * Find the first `actions[]` entry that failed with `state === 'ERROR'`.
 *
 * @param responseData - Parsed Aura response
 * @returns The failing action, or null when every action succeeded
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findErroredAction(responseData: any): Record<string, unknown> | null {
  if (!Array.isArray(responseData?.actions)) {
    return null;
  }

  return responseData.actions.find(
    (action: Record<string, unknown>) => action?.state === 'ERROR',
  ) || null;
}

/**
 * Inspect `actions[].state === 'ERROR'` and translate the Apex error into a
 * typed error.
 *
 * Without this, an Apex exception left `returnValue` empty and the caller
 * failed later with a misleading "No return value in Canada Life API response".
 *
 * @param responseData - Parsed Aura response
 * @param currentToken - Token used by the request
 * @throws `CanadaLifeTokenExpiredError` or `CanadaLifeApiError` when an action failed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkAuraActionErrors(responseData: any, currentToken: string): void {
  const erroredAction = findErroredAction(responseData);
  if (!erroredAction) {
    return;
  }

  const errors = Array.isArray(erroredAction.error) ? erroredAction.error : [];
  const firstError = (errors[0] || {}) as Record<string, unknown>;
  const exceptionType = (firstError.exceptionType as string) || '';
  const apexMessage = (firstError.message as string) || 'Unknown Apex error';

  debugLog('Aura action returned state=ERROR:', {
    id: erroredAction.id,
    exceptionType,
    message: apexMessage,
  });

  // Expired session — recoverable if a fresh token is already available
  const eventDescriptor = ((firstError.event as Record<string, unknown>)?.descriptor as string) || '';
  const isInvalidSession = erroredAction.exceptionEvent === true
    || INVALID_SESSION_MARKERS.some((marker) => eventDescriptor.includes(marker) || exceptionType.includes(marker));

  if (isInvalidSession) {
    throwTokenExpired(apexMessage, firstError, currentToken);
  }

  // Licence revoked / endpoint moved — needs a script update, not a re-login
  if (LICENSE_EXCEPTION_TYPES.some((type) => exceptionType.includes(type))) {
    throw new CanadaLifeApiError(formatLicenseExceptionMessage(apexMessage), firstError);
  }

  throw new CanadaLifeApiError(
    `Canada Life API error${exceptionType ? ` (${exceptionType})` : ''}: ${apexMessage}`,
    firstError,
  );
}

/**
 * Pull a human-readable reason out of a failed response envelope.
 *
 * @param envelope - Object carrying the failure flag
 * @returns Message string, or null if none present
 */
function extractEnvelopeMessage(envelope: Record<string, unknown>): string | null {
  for (const field of MESSAGE_FIELDS) {
    const value = envelope[field];
    // Some responses carry `error: "OK"` on success — never treat that as a reason
    if (typeof value === 'string' && value !== '' && value.toUpperCase() !== 'OK') {
      return value;
    }
  }

  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    const first = envelope.errors[0] as Record<string, unknown>;
    const message = (first?.message || first?.detail || first?.summary) as string | undefined;
    if (message) {
      return message;
    }
  }

  return null;
}

/**
 * Detect explicit `success: false` / `isSuccess: false` flags in the Mclaw
 * response envelopes.
 *
 * Server-side validation failures (for example "Make sure your date range is
 * not more than a year") arrive this way rather than as Apex exceptions.
 *
 * @param responseData - Parsed (possibly nested) response payload
 * @throws `CanadaLifeApiError` when a failure flag is set
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkEnvelopeFailureFlags(responseData: any): void {
  if (!responseData || typeof responseData !== 'object') {
    return;
  }

  // Consider the payload itself plus any single-level nested maps
  // (e.g. `activityReportMap`, `planSelectionMap`).
  const candidates: Record<string, unknown>[] = [responseData];
  for (const value of Object.values(responseData)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      candidates.push(value as Record<string, unknown>);
    }
  }

  const failed = candidates.filter(
    (candidate) => candidate.isSuccess === false || candidate.success === false,
  );

  if (failed.length === 0) {
    return;
  }

  // A failure is usually flagged on both the outer envelope (`isSuccess: false`,
  // with no detail) and the inner map (`success: false` plus the reason), so
  // prefer whichever candidate actually carries a message.
  const withMessage = failed
    .map((candidate) => ({ candidate, message: extractEnvelopeMessage(candidate) }))
    .find((entry) => entry.message !== null);

  const envelope = withMessage?.candidate ?? failed[0];
  const message = withMessage?.message
    ?? 'Canada Life reported the request was unsuccessful but gave no reason';

  debugLog('Canada Life response envelope reported failure:', { message, envelope });
  throw new CanadaLifeApiError(`Canada Life API error: ${message}`, envelope);
}

/**
 * Locate a legacy Vlocity `IPResult` block, either at the top level or inside
 * `actions[0].returnValue.returnValue`.
 *
 * @param responseData - Parsed Aura response
 * @returns The `IPResult` object, or null when absent
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLegacyIPResult(responseData: any): Record<string, unknown> | null {
  if (responseData?.IPResult) {
    return responseData.IPResult;
  }

  const nested = responseData?.actions?.[0]?.returnValue?.returnValue;
  if (!nested) {
    return null;
  }

  try {
    const nestedData = typeof nested === 'string' ? JSON.parse(nested) : nested;
    return nestedData?.IPResult || null;
  } catch (parseError) {
    debugLog('Could not parse nested response for error checking:', (parseError as Error).message);
    return null;
  }
}

/**
 * Legacy Vlocity error handling: `*HasApiFailure` flags plus
 * `IPResult.result.errors[]`.
 *
 * Retained for backward compatibility with any account still being served the
 * old integration-procedure responses.
 *
 * @param responseData - Parsed Aura response
 * @param currentToken - Token used by the request
 * @throws `CanadaLifeTokenExpiredError` or `CanadaLifeApiError` on failure
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkLegacyIPResultErrors(responseData: any, currentToken: string): void {
  const ipResult = findLegacyIPResult(responseData);
  if (!ipResult) {
    return;
  }

  const failureFlags = Object.entries(ipResult)
    .filter(([key, value]) => /has.*api.*failure/i.test(key) && value === true)
    .map(([key]) => key);

  if (failureFlags.length === 0) {
    return;
  }

  debugLog(`API failure flag(s) detected: ${failureFlags.join(', ')}`, ipResult);

  const result = ipResult.result as Record<string, unknown> | undefined;
  const errors = (result?.errors || []) as Array<Record<string, string>>;

  if (errors.length > 0) {
    debugLog('API errors found:', errors);

    const tokenError = errors.find((error) => error.errorId === '004' && error.httpCode === '401');
    if (tokenError) {
      debugLog('Token expired error detected:', tokenError);
      throwTokenExpired(
        tokenError.detail || tokenError.summary || 'Access token is invalid',
        tokenError,
        currentToken,
      );
    }

    const firstError = errors[0];
    const errorMessage = firstError.detail || firstError.summary || 'Unknown API error occurred';
    debugLog('Non-token API error detected:', firstError);
    throw new CanadaLifeApiError(`Canada Life API error: ${errorMessage}`, firstError);
  }

  throw new CanadaLifeApiError(
    `Canada Life API reported a failure (${failureFlags.join(', ')}) but no specific error details were provided`,
    Object.fromEntries(failureFlags.map((flag) => [flag, true])),
  );
}

/**
 * Log a COOSE warning when present.
 *
 * The stale-`fwuid` hint is only emitted when no concrete Apex error was
 * returned — otherwise it misdirects, since COOSE is frequently present
 * alongside a completely unrelated real failure.
 *
 * @param responseData - Parsed Aura response
 * @param hasApexError - Whether a concrete action-level error was found
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logCooseWarning(responseData: any, hasApexError: boolean): void {
  if (!Array.isArray(responseData?.actions)) {
    return;
  }

  const cooseAction = responseData.actions.find(
    (action: Record<string, unknown>) => action?.id === 'COOSE',
  );
  if (!cooseAction) {
    return;
  }

  debugLog('COOSE (Client Out Of Sync Error) detected in response:', cooseAction);

  if (!hasApexError) {
    debugLog('The Salesforce framework version (fwuid) may be out of sync. '
      + 'Dynamic context extraction should resolve this on retry.');
  }
}

/**
 * Inspect a Canada Life response for all known failure signals.
 *
 * @param responseData - Parsed API response
 * @param currentToken - Token used for the request
 * @returns The response data unchanged when no errors were detected
 * @throws `CanadaLifeTokenExpiredError` or `CanadaLifeApiError` when a failure is detected
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkApiResponseForErrors(responseData: any, currentToken: string): any {
  logCooseWarning(responseData, findErroredAction(responseData) !== null);

  checkAuraActionErrors(responseData, currentToken);
  checkEnvelopeFailureFlags(responseData);
  checkLegacyIPResultErrors(responseData, currentToken);

  return responseData;
}