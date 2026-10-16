/**
 * Tests for the Rogers Bank upload button's click handling.
 *
 * The button must be disabled before the Monarch login check, not after it: a
 * second click while the first is still waiting on the login would otherwise
 * start a second upload of the same transactions once the login completes.
 */

import { createRogersBankUploadButton } from '../../../src/ui/rogersbank/components/uploadButton';
import { uploadRogersBankToMonarch } from '../../../src/services/rogersbank-upload';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';
import rogersbank from '../../../src/api/rogersbank';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/api/rogersbank', () => ({
  __esModule: true,
  default: { checkRogersBankAuth: jest.fn(() => ({ authenticated: true })) },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/services/rogersbank-upload', () => ({
  uploadRogersBankToMonarch: jest.fn(),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

/** Let pending promise callbacks run */
const flush = () => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe('Rogers Bank upload button', () => {
  let button;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    button = createRogersBankUploadButton().querySelector('button');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts only one upload when clicked again while the Monarch login is pending', async () => {
    let completeLogin;
    ensureMonarchAuthentication.mockReturnValue(new Promise((resolve) => {
      completeLogin = resolve;
    }));
    uploadRogersBankToMonarch.mockResolvedValue({ success: true });

    button.click();
    expect(button.disabled).toBe(true);
    button.click();

    completeLogin(true);
    await flush();

    expect(ensureMonarchAuthentication).toHaveBeenCalledTimes(1);
    expect(uploadRogersBankToMonarch).toHaveBeenCalledTimes(1);
  });

  it('re-enables the button when the Monarch login is cancelled', async () => {
    ensureMonarchAuthentication.mockResolvedValue(false);

    button.click();
    await flush();

    expect(uploadRogersBankToMonarch).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Upload to Monarch');
  });

  it('re-enables the button after the upload finishes', async () => {
    ensureMonarchAuthentication.mockResolvedValue(true);
    uploadRogersBankToMonarch.mockResolvedValue({ success: true });

    button.click();
    expect(button.textContent).toBe('Processing...');
    await flush();

    expect(uploadRogersBankToMonarch).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });
});

describe('Rogers Bank upload button before credentials are captured', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rogersbank.checkRogersBankAuth.mockReturnValueOnce({ authenticated: false, credentials: {} });
  });

  it('shows the waiting state instead of an upload button', () => {
    const container = createRogersBankUploadButton();

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('#rogersbank-credentials-waiting-message').textContent)
      .toBe('Waiting for Rogers Bank credentials to be captured...');
  });

  it('explains that credentials are captured again after a reload', () => {
    const container = createRogersBankUploadButton();

    expect(container.querySelector('#rogersbank-credentials-waiting-help').textContent)
      .toContain('captured again after a reload');
  });
});

describe('Rogers Bank upload button after credentials are captured', () => {
  it('renders the upload button with its id', () => {
    const container = createRogersBankUploadButton();

    expect(container.querySelector('#rogersbank-upload-button').textContent).toBe('Upload to Monarch');
    expect(container.querySelector('#rogersbank-credentials-waiting-message')).toBeNull();
  });
});
