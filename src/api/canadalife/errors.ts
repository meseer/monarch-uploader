/**
 * Canada Life error classes.
 *
 * @module api/canadalife/errors
 */

/**
 * Raised when the Canada Life Aura token has expired.
 *
 * `recoverable` is true when a fresh token was found in localStorage, which
 * signals to `makeAuraApiCall` that a single retry is worthwhile.
 */
export class CanadaLifeTokenExpiredError extends Error {
  name = 'CanadaLifeTokenExpiredError';
  errorDetails: unknown;
  recoverable: boolean;

  constructor(message: string, errorDetails: unknown = null) {
    super(message);
    this.errorDetails = errorDetails;
    this.recoverable = true;
  }
}

/**
 * Raised for non-token Canada Life API failures (Apex exceptions, server-side
 * validation failures, missing data).
 */
export class CanadaLifeApiError extends Error {
  name = 'CanadaLifeApiError';
  errorDetails: unknown;
  recoverable: boolean;

  constructor(message: string, errorDetails: unknown = null) {
    super(message);
    this.errorDetails = errorDetails;
    this.recoverable = false;
  }
}