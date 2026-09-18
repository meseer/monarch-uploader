/**
 * Progress Dialog - XSS escaping regression tests
 *
 * `showError` renders `error.message`, which deliberately carries the raw
 * Monarch/GraphQL HTTP response body. A WAF/CDN HTML error page (or a crafted
 * upstream body) must be shown as text and never parsed into live markup.
 *
 * This suite uses the real jsdom document on purpose; the main progressDialog
 * suite stubs `document.createElement`, which cannot observe HTML parsing.
 */

import { showProgressDialog } from '../../src/ui/components/progressDialog';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

const PAYLOAD = '<img src=x onerror=alert(1)>';

describe('Progress Dialog XSS escaping', () => {
  let dialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    dialog = showProgressDialog([{ key: 'acc1', nickname: 'Test Account 1' }]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getErrorContainer = () => document.querySelector('[id^="balance-uploader-error-container-"]');

  it('renders an HTML error body as text, not as elements', () => {
    dialog.showError('acc1', new Error(`Upload failed: ${PAYLOAD}`));

    const container = getErrorContainer();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('#error-message').textContent)
      .toBe(`Upload failed: ${PAYLOAD}`);
  });

  it('renders a malicious account id as text, not as elements', () => {
    dialog.showError(PAYLOAD, new Error('boom'));

    const container = getErrorContainer();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('#error-title').textContent)
      .toBe(`Error uploading account ${PAYLOAD}:`);
  });

  it('still renders the acknowledgment buttons', () => {
    dialog.showError('acc1', new Error('boom'));

    const container = getErrorContainer();
    expect(container.querySelector('#error-close-button')).toBeTruthy();
    expect(container.querySelector('#error-ack-button')).toBeTruthy();
    expect(container.style.display).toBe('block');
  });

  it('falls back to the stringified error when message is missing', () => {
    dialog.showError('acc1', {});

    const container = getErrorContainer();
    expect(container.querySelector('#error-message').textContent)
      .toBe('[object Object]');
  });
});
