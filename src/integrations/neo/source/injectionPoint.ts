import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  selectors: [],
  isSPA: true,
  pageModes: [
    {
      id: 'accounts',
      urlPattern: /\/accounts\/?$/,
      uiType: 'all-accounts',
      selectors: [{ selector: '.MuiContainer-root.MuiContainer-maxWidthXl', insertMethod: 'prepend' }],
    },
    {
      id: 'account',
      urlPattern: /\/accounts\/(?:credit|savings)\/([^/?]+)/,
      uiType: 'all-accounts',
      selectors: [{ selector: '.MuiContainer-root.MuiContainer-maxWidthXl', insertMethod: 'prepend' }],
    },
  ],
  appPagePatterns: [/\/accounts(?:\/|$)/],
  skipPatterns: [/\/login(?:\/|$)/, /\/signup(?:\/|$)/],
  containerId: 'monarch-uploader-neo',
};

export default injectionPoint;
