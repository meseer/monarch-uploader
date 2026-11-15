/**
 * Domain / Hostname Matching Utilities
 *
 * Dependency-free helper for safe hostname matching.
 * Prevents incomplete URL substring sanitization (CWE-20) where
 * `hostname.includes('example.com')` or `hostname.endsWith('example.com')`
 * would match attacker-controlled domains like `evilexample.com` or
 * `example.com.attacker.com`.
 */

/**
 * Check whether `hostname` is `domain` itself or a subdomain of `domain`.
 *
 * @param hostname - Hostname to test (e.g. `window.location.hostname`)
 * @param domain - Expected base domain (e.g. `questrade.com`)
 */
export function isHostnameMatch(hostname: string, domain: string): boolean {
  if (!hostname || !domain) return false;

  const normalizedHost = hostname.trim().toLowerCase().replace(/\.+$/, '');
  const normalizedDomain = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');

  if (!normalizedHost || !normalizedDomain) return false;

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}
