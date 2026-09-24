import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  selectors: [],
  isSPA: true,
  pageModes: [
    {
      id: 'accounts',
      urlPattern: /\/accounts\/?$/,
      uiType: 'all-accounts',
      selectors: [{ selector: 'main', insertMethod: 'prepend' }],
    },
    {
      id: 'account',
      urlPattern: /\/accounts\/(?:credit|savings)\/([^/?]+)/,
      uiType: 'all-accounts',
      selectors: [{ selector: 'main', insertMethod: 'prepend' }],
    },
  ],
  appPagePatterns: [/\/accounts(?:\/|$)/],
  skipPatterns: [/\/login(?:\/|$)/, /\/signup(?:\/|$)/],
  containerId: 'monarch-uploader-neo',
};

export default injectionPoint;
