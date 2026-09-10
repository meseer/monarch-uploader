/**
 * Version Badge Component
 *
 * Single home for all userscript version display UI. Provides two variants:
 *
 * - `createVersionBadge()` — a passive, greyed-out indicator appended to the
 *   institution card headers so the running version can be identified at a glance.
 * - `createVersionLink()` — an actionable link to the gist source, used in the
 *   settings modal sidebar.
 *
 * Both read the version from `scriptInfo.json`, which is the single source of
 * truth maintained by `npm run version:bump`.
 *
 * @module ui/components/versionBadge
 */

import scriptInfo from '../../scriptInfo.json';

/** Display label for the current userscript version, e.g. `v7.14.0` */
export const VERSION_LABEL = `v${scriptInfo.version}`;

/**
 * Creates a small, unobtrusive version indicator for card headers.
 *
 * Rendered as a non-interactive `<span>` in a muted grey so it sits visually
 * subordinate to the card title and does not compete with surrounding UI.
 *
 * @param idPrefix - Component/integration prefix used to build a unique element
 *   ID (e.g. `wealthsimple` produces `wealthsimple-version-badge`)
 * @returns The version badge element
 */
export function createVersionBadge(idPrefix: string): HTMLSpanElement {
  if (!idPrefix) {
    throw new Error('createVersionBadge requires an idPrefix to build a unique element ID');
  }

  const badge = document.createElement('span');
  badge.id = `${idPrefix}-version-badge`;
  badge.textContent = VERSION_LABEL;
  badge.title = `Monarch Uploader ${VERSION_LABEL}`;
  badge.style.cssText = `
    font-size: 11px;
    font-weight: 400;
    color: var(--mu-text-secondary, #999);
    letter-spacing: 0.2px;
    align-self: baseline;
    user-select: none;
  `;

  return badge;
}

/**
 * Creates the clickable version link used in the settings modal sidebar.
 *
 * Links to the published gist so the user can inspect or re-install the script.
 *
 * @returns The version link element
 */
export function createVersionLink(): HTMLAnchorElement {
  const versionLink = document.createElement('a');
  versionLink.id = 'settings-version-link';
  versionLink.href = scriptInfo.gistUrl;
  versionLink.target = '_blank';
  versionLink.rel = 'noopener noreferrer';
  versionLink.textContent = VERSION_LABEL;
  versionLink.style.cssText = `
    font-size: 12px;
    color: var(--mu-text-secondary, #666);
    text-decoration: none;
    display: inline-block;
    transition: color 0.2s;
  `;
  versionLink.addEventListener('mouseover', () => {
    versionLink.style.color = 'var(--mu-link-color, #0073b1)';
    versionLink.style.textDecoration = 'underline';
  });
  versionLink.addEventListener('mouseout', () => {
    versionLink.style.color = 'var(--mu-text-secondary, #666)';
    versionLink.style.textDecoration = 'none';
  });

  return versionLink;
}