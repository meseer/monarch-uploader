import toast from '../../../src/ui/toast';
import { initGenericUI } from '../../../src/ui/generic/uiManager';

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../../src/ui/toast', () => ({
  default: {
    show: vi.fn(),
  },
}));

vi.mock('../../../src/ui/components/settingsModal', () => ({
  showSettingsModal: vi.fn(),
}));

vi.mock('../../../src/services/auth', () => ({
  default: {
    getMonarchCredentials: vi.fn(() => ({ csrfToken: 'test' })),
  },
}));

describe('Generic UI Manager initialization idempotency', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="side-menu"><div class="quick-actions-container"></div></div>';
    vi.clearAllMocks();
  });

  it('prevents duplicate Upload to Monarch buttons and toasts when concurrent initializations race', async () => {
    const resolvers = [];
    const api = {
      getAccountsSummary: vi.fn(() => new Promise((resolve) => {
        resolvers.push(resolve);
      })),
    };

    const registryEntry = {
      manifest: {
        id: 'pcfinancial-race-test',
        displayName: 'PC Financial',
        brandColor: '#333333',
      },
      injectionPoint: {
        containerId: 'monarch-uploader-pcfinancial-race-test',
        selectors: [{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }],
        isSPA: true,
        pageModes: [{
          id: 'banking',
          urlPattern: /\//,
          uiType: 'all-accounts',
          selectors: [{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }],
        }],
        skipPatterns: [/login/],
        containerStyle: {
          background: '#e0d9ff',
          border: '2px solid rgba(198, 185, 255, 0.2)',
          borderRadius: '12px',
          boxShadow: 'none',
          padding: '12px',
        },
      },
      api,
      syncHooks: {},
    };

    // Start two overlapping initializations while probeConnection is still awaiting the network
    const init1 = initGenericUI(registryEntry);
    const init2 = initGenericUI(registryEntry);

    resolvers.forEach((resolve) => resolve([{ accountId: 'acc-1', displayName: 'PC Mastercard (5570)' }]));
    await Promise.all([init1, init2]);

    const container = document.getElementById('monarch-uploader-pcfinancial-race-test');
    expect(container).not.toBeNull();
    expect(container.style.borderRadius).toBe('12px');

    const uploadButtonContainers = container.querySelectorAll('#generic-upload-button-container');
    expect(uploadButtonContainers).toHaveLength(1);

    const connectionContainers = container.querySelectorAll('#generic-connection-status');
    expect(connectionContainers).toHaveLength(1);

    const initializedToasts = toast.show.mock.calls.filter(
      ([msg]) => msg === 'PC Financial Balance Uploader initialized',
    );
    expect(initializedToasts).toHaveLength(1);
  });
});
