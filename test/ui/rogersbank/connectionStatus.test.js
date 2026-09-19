/**
 * Tests for the Rogers Bank Connection Status credentials display
 *
 * Credential values are captured from the institution's own page, so the
 * credentials list is built from DOM nodes rather than a markup string.
 */

import {
  createConnectionStatus,
  updateCredentialsDisplay,
} from '../../../src/ui/rogersbank/components/connectionStatus';

const PAYLOAD = '<img src=x onerror=alert(1)>';

describe('Rogers Bank credentials display', () => {
  let container;
  let credentialsList;

  beforeEach(() => {
    container = createConnectionStatus();
    credentialsList = container.querySelector('.credentials-list');
  });

  it('renders one labelled row per credential', () => {
    updateCredentialsDisplay(container, {
      authToken: 'tokenvalue1234567890',
      accountId: 'acc-1',
      customerId: 'cust-1',
      deviceId: 'devicevalue1234567890',
      lastUpdated: '2024-01-10T00:00:00Z',
    });

    const rows = credentialsList.querySelectorAll('div');
    expect(rows).toHaveLength(5);
    expect(rows[0].querySelector('strong').textContent).toBe('Auth Token:');
    expect(rows[1].textContent).toBe('Account ID: acc-1');
    expect(rows[4].textContent).toBe('Last Updated: 2024-01-10T00:00:00Z');
  });

  it('masks long sensitive values and shows a placeholder when missing', () => {
    updateCredentialsDisplay(container, {
      authToken: 'abcdefghijklmnop',
      deviceId: 'short',
    });

    expect(credentialsList.textContent).toContain('Auth Token: abcdef...mnop');
    expect(credentialsList.textContent).toContain('Device ID: short');
    expect(credentialsList.textContent).toContain('Account ID: Not captured');
  });

  it('renders a malicious credential value as text, not an element', () => {
    updateCredentialsDisplay(container, { accountId: PAYLOAD });

    expect(credentialsList.querySelector('img')).toBeNull();
    expect(credentialsList.textContent).toContain(`Account ID: ${PAYLOAD}`);
  });

  it('replaces previous rows instead of appending on each update', () => {
    updateCredentialsDisplay(container, { accountId: 'acc-1' });
    updateCredentialsDisplay(container, { accountId: 'acc-2' });

    expect(credentialsList.querySelectorAll('div')).toHaveLength(5);
    expect(credentialsList.textContent).toContain('Account ID: acc-2');
    expect(credentialsList.textContent).not.toContain('acc-1');
  });

  it('does nothing when the container has no credentials list', () => {
    const empty = document.createElement('div');

    expect(() => updateCredentialsDisplay(empty, { accountId: 'acc-1' })).not.toThrow();
  });
});
