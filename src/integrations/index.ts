/**
 * Integration Modules — Build-time Barrel
 *
 * Imports all available integration modules and exports them as an array.
 * In the future, build-time configuration (e.g., webpack DefinePlugin)
 * can select which integrations to include in the bundle.
 *
 * @module integrations
 */

import type { IntegrationModule } from './types';
import * as mbna from './mbna';

/* eslint-disable no-underscore-dangle */
declare const __ENABLED_INTEGRATIONS__: string[] | undefined;
/* eslint-enable no-underscore-dangle */

/**
 * All integration modules keyed by ID.
 * As existing integrations are migrated to the module architecture,
 * they will be added here.
 */
const ALL: Record<string, IntegrationModule> = {
  mbna: mbna as unknown as IntegrationModule,
  // Future: wealthsimple, questrade, canadalife, rogersbank
};

/**
 * Build-time integration selection.
 * When __ENABLED_INTEGRATIONS__ is defined by webpack DefinePlugin,
 * only the specified integrations are bundled. Otherwise, all are included.
 */
const enabled: string[] | 'all' = typeof __ENABLED_INTEGRATIONS__ !== 'undefined'
  ? __ENABLED_INTEGRATIONS__
  : 'all';

export const AVAILABLE_INTEGRATIONS: IntegrationModule[] = enabled === 'all'
  ? Object.values(ALL)
  : (enabled as string[]).map((id) => ALL[id]).filter(Boolean);

export default AVAILABLE_INTEGRATIONS;