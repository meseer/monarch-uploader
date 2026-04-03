# Security Policy

> **Status:** Active  
> **Updated:** 2026-04-03  
> **Author:** @meseer  

## Reporting a Vulnerability

If you discover a security vulnerability in Monarch Uploader, **please report it responsibly**. Do not open a public GitHub issue.

### How to Report

1. **Preferred:** Use [GitHub Security Advisories](https://github.com/meseer/monarch-uploader/security/advisories/new) to report privately.
2. **Alternative:** Email **meseer** via the contact information on the [GitHub profile](https://github.com/meseer).

### What to Include

- A clear description of the vulnerability
- Steps to reproduce the issue
- The potential impact (e.g., credential exposure, data leakage)
- Any suggested fix (optional but appreciated)

### Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 72 hours |
| Initial assessment | Within 1 week |
| Fix or mitigation | Best effort, depends on severity |

## Scope

### In Scope

These are considered security vulnerabilities:

- **Credential exposure** — Monarch Money or institution credentials leaking outside the browser (e.g., logged to console, sent to unintended endpoints)
- **Cross-site scripting (XSS)** — Injected UI components that could be exploited by malicious pages
- **Data exfiltration** — Financial data being sent to any destination other than the user's authenticated Monarch Money account
- **Authentication bypass** — Ways to use the script's API calls without proper user authentication
- **Storage leakage** — Sensitive data stored insecurely or accessible to other scripts/extensions
- **Dependency vulnerabilities** — Known CVEs in project dependencies that have a realistic exploit path

### Out of Scope

These are **not** security vulnerabilities for this project:

- Institution API changes that break sync functionality
- Monarch Money API changes or downtime
- Issues that require physical access to the user's machine
- Attacks that require the user to install a malicious browser extension
- Rate limiting or abuse of institution APIs (this is the institution's responsibility)
- Theoretical attacks with no practical exploit path

## Security Architecture

Monarch Uploader is a browser userscript that runs locally. Key security properties:

- **No external servers** — All data flows directly between the user's browser, their institution, and Monarch Money. There is no intermediary server.
- **Local credential storage** — Credentials are stored via the userscript manager's `GM_getValue`/`GM_setValue` API, which is sandboxed per-script.
- **No telemetry** — The script does not collect, transmit, or log any usage data or financial information to third parties.

## Supported Versions

Security fixes are applied to the latest version only. There is no backport policy for older versions — users should always update to the latest release.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older versions | ❌ |