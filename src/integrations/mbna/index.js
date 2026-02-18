/**
 * MBNA Integration Module — Barrel Export
 *
 * Exports the standard IntegrationModule shape as defined in
 * src/integrations/types.js. This is the reference implementation.
 *
 * @module integrations/mbna
 * @type {import('../types').IntegrationModule}
 */

import * as monarchMapperNs from './monarch-mapper';

export { default as manifest } from './manifest';
export { createApi } from './api';
export { createAuth } from './auth';
export { default as injectionPoint } from './injectionPoint';
export {
  separateAndDeduplicateTransactions,
  generatePendingTransactionId,
  formatPendingIdForNotes,
} from './monarch-mapper';

/**
 * Monarch mapper re-exported as a namespace object for registry registration.
 * Since monarch-mapper has no default export, we import all named exports
 * and re-export them as a single object.
 */
export const monarchMapper = monarchMapperNs;