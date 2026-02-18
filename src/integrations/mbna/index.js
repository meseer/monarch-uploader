/**
 * MBNA Integration Module — Barrel Export
 *
 * Exports the standard IntegrationModule shape as defined in
 * src/integrations/types.js. This is the reference implementation.
 *
 * @module integrations/mbna
 * @type {import('../types').IntegrationModule}
 */

import * as monarchMapperNs from './sinks/monarch';

export { default as manifest } from './manifest';
export { createApi } from './source/api';
export { createAuth } from './source/auth';
export { default as injectionPoint } from './source/injectionPoint';
export {
  separateAndDeduplicateTransactions,
  generatePendingTransactionId,
  formatPendingIdForNotes,
} from './sinks/monarch';

/**
 * Monarch mapper re-exported as a namespace object for registry registration.
 * Since the monarch sink adapter has no default export, we import all named exports
 * and re-export them as a single object.
 */
export const monarchMapper = monarchMapperNs;