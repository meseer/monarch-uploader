/**
 * HTTP Response Body Helpers
 *
 * Shared parsing for API response bodies, so every client turns a malformed or
 * error-carrying response into a diagnosable error instead of a raw
 * `SyntaxError` or `TypeError`.
 *
 * These are pure functions: they take the raw body and a `source` label naming
 * the call (e.g. `Monarch API Error: GetAccounts`), and throw errors prefixed
 * with that label. Status-code handling stays with each client, because the
 * right reaction to a 401 (clear which credentials, show which message) is
 * institution-specific.
 *
 * @module core/httpResponse
 */

/**
 * Cap on how much of a response body is quoted into an error message.
 *
 * Enough to hold a GraphQL errors array or identify an error page; short enough
 * that an HTML error page cannot flood the log or a toast.
 */
export const RESPONSE_EXCERPT_MAX_LENGTH = 500;

/**
 * Return a bounded excerpt of a raw response body.
 *
 * @param responseText - Raw response body
 * @returns At most RESPONSE_EXCERPT_MAX_LENGTH characters, or '' when empty
 */
export function excerptResponseBody(responseText: string | null | undefined): string {
  return (responseText || '').slice(0, RESPONSE_EXCERPT_MAX_LENGTH);
}

/**
 * Pull a readable explanation out of an error response body.
 *
 * GraphQL servers answer a refused request with an `errors` array, and that
 * array is frequently the *only* explanation of what was objected to. The
 * `locations` entry in particular identifies the offending part of the query,
 * which is often the only way to tell an unsupported field from a malformed
 * value — the error `message` itself can be entirely generic. The serialized
 * array is returned rather than just the messages, so `locations` survives.
 *
 * @param responseText - Raw response body, which may not be JSON at all
 * @returns Serialized errors, a bounded excerpt of the body, or '' when empty
 */
export function extractResponseErrorDetail(responseText: string | null | undefined): string {
  if (!responseText) return '';

  try {
    const parsed = JSON.parse(responseText);
    if (parsed?.errors) return JSON.stringify(parsed.errors);
  } catch {
    // Not JSON (an HTML error page, say) — fall through to the raw text.
  }

  return excerptResponseBody(responseText);
}

/**
 * Parse a success-status response body as JSON.
 *
 * A 2xx whose body is not JSON is a real failure mode, not a theoretical one: a
 * WAF or CDN HTML error page, a captive-portal or proxy interstitial, a
 * rate-limit page, and a truncated body all arrive with a success status. The
 * body is the only evidence of which of those happened, so a bounded excerpt of
 * it travels with the error.
 *
 * @param responseText - Raw response body
 * @param source - Label naming the failed call, used as the error prefix
 * @returns The parsed body
 * @throws When the body is not JSON
 */
export function parseJsonBody<T = unknown>(responseText: string | null | undefined, source: string): T {
  try {
    // `?? ''` matters: JSON.parse(null) coerces to "null" and succeeds, which
    // would pass a missing body off as a valid JSON null.
    return JSON.parse(responseText ?? '') as T;
  } catch (error) {
    const excerpt = excerptResponseBody(responseText);
    throw new Error(
      `${source} returned a success status with a body that is not JSON `
      + `(${(error as Error).message})${excerpt ? ` — ${excerpt}` : ''}`,
      { cause: error },
    );
  }
}

/**
 * Unwrap the `data` of a parsed GraphQL response body.
 *
 * Throws when the body carries `errors` (an empty array does not count). The
 * whole value is serialized into the message — not just the `message` fields —
 * because `locations`, `path` and `extensions` are often the only clue to the
 * cause.
 *
 * The body's shape is otherwise not validated: a body without `data` (or a
 * `null` body) yields `undefined`, and callers validate the fields they need.
 *
 * @param body - Parsed response body (e.g. from parseJsonBody)
 * @param source - Label naming the failed call, used as the error prefix
 * @returns The `data` member, or undefined when absent
 * @throws When the body carries GraphQL errors
 */
export function unwrapGraphQLData<T = unknown>(body: unknown, source: string): T | undefined {
  const { data, errors } = (body ?? {}) as { data?: T; errors?: unknown };

  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(errors);
  if (hasErrors) {
    throw new Error(`${source} returned GraphQL errors: ${JSON.stringify(errors)}`);
  }
  return data;
}
