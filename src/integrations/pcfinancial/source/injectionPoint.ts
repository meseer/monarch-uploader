import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  selectors: [{ selector: 'body', insertMethod: 'append' }],
  isSPA: true,
  pageModes: [{
    id: 'banking',
    urlPattern: /\//,
    uiType: 'all-accounts',
    selectors: [{ selector: 'body', insertMethod: 'append' }],
  }],
  appPagePatterns: [/\//],
  skipPatterns: [/login/, /sign-in/, /logout/],
  containerId: 'monarch-uploader-pcfinancial',
};

export default injectionPoint;
