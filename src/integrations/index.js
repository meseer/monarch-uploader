/**
 * Integration Modules — Build-time Barrel
 *
 * Imports all available integration modules and exports them as an array.
 * In the future, build-time configuration (e.g., webpack DefinePlugin)
 * can select which integrations to include in the bundle.
 *
 * @module integrations
 */

import * as mbna from './mbna';

/**
 * All integration modules keyed by ID.
 * As existing integrations are migrated to the module architecture,
 * they will be added here.
 */
const ALL = {
  mbna,
  // Future: wealthsimple, questrade, canadalife, rogersbank
};

/**
 * Build-time integration selection.
 * When __ENABLED_INTEGRATIONS__ is defined by webpack DefinePlugin,
 * only the specified integrations are bundled. Otherwise, all are included.
 *
 * @type {import('./types').IntegrationModule[]}
 */
/* eslint-disable no-undef */
const enabled = typeof __ENABLED_INTEGRATIONS__ !== 'undefined'
  ? __ENABLED_INTEGRATIONS__
  : 'all';
/* eslint-enable no-undef */

export const AVAILABLE_INTEGRATIONS = enabled === 'all'
  ? Object.values(ALL)
  : enabled.map((id) => ALL[id]).filter(Boolean);

export default AVAILABLE_INTEGRATIONS;