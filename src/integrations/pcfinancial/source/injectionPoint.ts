import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  selectors: [{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }],
  isSPA: true,
  pageModes: [{
    id: 'banking',
    urlPattern: /\//,
    uiType: 'all-accounts',
    selectors: [{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }],
  }],
  appPagePatterns: [/\//],
  skipPatterns: [/login/, /sign-in/, /logout/],
  containerId: 'monarch-uploader-pcfinancial',
  containerStyle: {
    background: '#e0d9ff',
    border: '2px solid rgba(198, 185, 255, 0.2)',
    borderRadius: '12px',
    boxShadow: 'none',
    padding: '12px',
  },
};

export default injectionPoint;
