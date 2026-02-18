/**
 * MBNA Integration Module — Barrel Export
 *
 * Exports the standard IntegrationModule shape as defined in
 * src/integrations/types.js. This is the reference implementation.
 *
 * @module integrations/mbna
 * @type {import('../types').IntegrationModule}
 */

export { default as manifest } from './manifest';
export { createApi } from './api';
export { createAuth } from './auth';
export { default as injectionPoint } from './injectionPoint';
export {
  applyTransactionRule,
  hasRuleForTransaction,
  separateAndDeduplicateTransactions,
  generatePendingId,
  formatPendingIdForNotes,
} from './monarch-mapper';

/**
 * Monarch mapper as a single object (for registry registration)
 */
export { default as monarchMapper } from './monarch-mapper';