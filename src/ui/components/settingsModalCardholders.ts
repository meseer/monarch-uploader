/**
 * Settings Modal — Cardholder Mappings Widget
 *
 * Reusable, capability-driven settings section for integrations that expose a
 * cardholder name on their transactions (`hasCardholders`). Rendered per account
 * by `createGenericAccountCards`, so it appears identically for legacy tabs
 * (Rogers Bank) and modular tabs (MBNA) with no per-integration UI code.
 *
 * Lives in its own file because `settingsModalHelpers.ts` (1200+ lines) and
 * `settingsModalAccountCards.ts` (1000+ lines) are both close to the 1500-line
 * file size cap.
 *
 * @module ui/components/settingsModalCardholders
 */

import { debugLog } from '../../core/utils';
import { CARDHOLDER } from '../../core/config';
import { ACCOUNT_SETTINGS, hasCapability } from '../../core/integrationCapabilities';
import accountService from '../../services/common/accountService';
import { getHouseholdMembers, type HouseholdMember } from '../../api/monarchHousehold';
import { describeMatchType } from '../../services/common/cardholderMatching';
import type { CardholderEntry, CardholderMap } from '../../services/common/cardholders';
import { createToggleSwitch } from './settingsModalHelpers';
import toast from '../toast';

// ── Types ───────────────────────────────────────────────────

/** The subset of the account entry this widget reads */
interface CardholderAccountEntry {
  cardholderOwnerMode?: string;
  cardholderTagMode?: string;
  cardholders?: CardholderMap;
  [key: string]: unknown;
}

/** Sentinel select value representing "Shared" */
const SHARED_VALUE = '__shared__';

// ── Small UI helpers ────────────────────────────────────────

/**
 * Create a labelled toggle settings row.
 *
 * Used for the owner mode, which is a plain on/off choice — a toggle matches the
 * other boolean settings in the account card rather than introducing a
 * two-option dropdown.
 */
function createToggleSetting({
  id,
  title,
  description,
  isEnabled,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  isEnabled: boolean;
  onChange: (isEnabled: boolean) => void;
}): HTMLElement {
  const row = document.createElement('div');
  row.id = id;
  row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; '
    + 'padding: 8px 12px; background: var(--mu-bg-primary, white); border-radius: 6px; margin-bottom: 8px;';

  const labelDiv = document.createElement('div');
  labelDiv.style.cssText = 'flex-grow: 1; min-width: 0;';

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-weight: 500; font-size: 13px;';
  titleDiv.textContent = title;
  labelDiv.appendChild(titleDiv);

  const descDiv = document.createElement('div');
  descDiv.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666);';
  descDiv.textContent = description;
  labelDiv.appendChild(descDiv);

  row.appendChild(labelDiv);

  const toggleContainer = document.createElement('div');
  toggleContainer.id = `${id}-toggle`;
  toggleContainer.style.cssText = 'flex-shrink: 0;';
  toggleContainer.appendChild(createToggleSwitch(isEnabled, onChange, false));
  toggleContainer.addEventListener('click', (e: Event) => e.stopPropagation());
  row.appendChild(toggleContainer);

  row.addEventListener('click', (e: Event) => e.stopPropagation());
  return row;
}

/**
 * Create a labelled `<select>` settings row.
 */
function createSelectSetting({
  id,
  title,
  description,
  options,
  currentValue,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  options: Array<{ value: string; label: string }>;
  currentValue: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const row = document.createElement('div');
  row.id = id;
  row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; '
    + 'padding: 8px 12px; background: var(--mu-bg-primary, white); border-radius: 6px; margin-bottom: 8px;';

  const labelDiv = document.createElement('div');
  labelDiv.style.cssText = 'flex-grow: 1; min-width: 0;';

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-weight: 500; font-size: 13px;';
  titleDiv.textContent = title;
  labelDiv.appendChild(titleDiv);

  const descDiv = document.createElement('div');
  descDiv.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666);';
  descDiv.textContent = description;
  labelDiv.appendChild(descDiv);

  row.appendChild(labelDiv);

  const select = document.createElement('select');
  select.id = `${id}-select`;
  select.style.cssText = 'padding: 4px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; '
    + 'font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333); flex-shrink: 0;';

  options.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    opt.selected = option.value === currentValue;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => onChange(select.value));
  select.addEventListener('click', (e: Event) => e.stopPropagation());

  row.appendChild(select);
  row.addEventListener('click', (e: Event) => e.stopPropagation());
  return row;
}

/**
 * Create the match-type badge shown on each cardholder row.
 */
function createMatchBadge(entry: CardholderEntry): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.style.cssText = 'font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; flex-shrink: 0;';

  if (entry.monarchUserId) {
    badge.style.background = 'var(--mu-status-success-bg, #e8f5e9)';
    badge.style.color = 'var(--mu-status-success-text, #28a745)';
    badge.textContent = entry.matchType === 'manual' ? 'Manual' : 'Auto';
    badge.title = describeMatchType(entry.matchType);
  } else if (entry.isShared) {
    badge.style.background = 'var(--mu-badge-bg, #e3f2fd)';
    badge.style.color = 'var(--mu-badge-text, #1565c0)';
    badge.textContent = CARDHOLDER.SHARED_OWNER;
    badge.title = 'Transactions from this card have no specific owner';
  } else {
    badge.style.background = 'var(--mu-bg-tertiary, #f5f5f5)';
    badge.style.color = 'var(--mu-text-secondary, #666)';
    badge.textContent = 'Not mapped';
    badge.title = 'You will be prompted to map this cardholder on the next sync';
  }

  return badge;
}

/**
 * Persist a cardholder entry change back to the consolidated account storage.
 */
function saveCardholderEntry(
  integrationId: string,
  accountId: string,
  cardholderName: string,
  updates: Partial<CardholderEntry>,
): boolean {
  const accountData = accountService.getAccountData(integrationId, accountId);
  const cardholders = { ...((accountData?.cardholders as CardholderMap) || {}) };
  const existing = cardholders[cardholderName];

  if (!existing) {
    debugLog(`[settingsCardholders] Cardholder "${cardholderName}" not found, cannot update`);
    return false;
  }

  cardholders[cardholderName] = { ...existing, ...updates };
  return accountService.updateAccountInList(integrationId, accountId, { cardholders });
}

// ── Cardholder row ──────────────────────────────────────────

/**
 * Build the editable label input for a cardholder (drives the tag value).
 */
function createLabelInput(
  integrationId: string,
  accountId: string,
  cardholderName: string,
  entry: CardholderEntry,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.id = `cardholder-label-input-${entry.cardLast4 || cardholderName.replace(/\s+/g, '-').toLowerCase()}`;
  input.value = entry.label || '';
  input.placeholder = 'Tag label';
  input.style.cssText = 'width: 140px; padding: 4px 8px; border: 1px solid var(--mu-input-border, #ccc); '
    + 'border-radius: 4px; font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';

  input.addEventListener('change', () => {
    const newLabel = input.value.trim();
    if (!newLabel) {
      input.value = entry.label || '';
      toast.show('Tag label cannot be empty', 'error');
      return;
    }

    if (saveCardholderEntry(integrationId, accountId, cardholderName, { label: newLabel })) {
      toast.show(`Tag label set to "${newLabel}"`, 'info');
    } else {
      input.value = entry.label || '';
      toast.show('Failed to update tag label', 'error');
    }
  });
  input.addEventListener('click', (e: Event) => e.stopPropagation());

  return input;
}

/**
 * Build the household member `<select>` for a cardholder.
 *
 * Options are "Shared" plus every household member. Selecting anything pins
 * `matchType: 'manual'` so the choice is never overwritten by auto-matching and
 * the sync no longer prompts for this cardholder.
 */
function createMemberSelect(
  integrationId: string,
  accountId: string,
  cardholderName: string,
  entry: CardholderEntry,
  members: HouseholdMember[],
  onRefresh: (() => void) | null,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = `cardholder-member-select-${entry.cardLast4 || cardholderName.replace(/\s+/g, '-').toLowerCase()}`;
  select.style.cssText = 'padding: 4px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; '
    + 'font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';

  const sharedOption = document.createElement('option');
  sharedOption.value = SHARED_VALUE;
  sharedOption.textContent = CARDHOLDER.SHARED_OWNER;
  sharedOption.selected = !entry.monarchUserId;
  select.appendChild(sharedOption);

  members.forEach((member) => {
    const opt = document.createElement('option');
    opt.value = member.id;
    opt.textContent = member.name;
    opt.selected = member.id === entry.monarchUserId;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    const updates: Partial<CardholderEntry> = select.value === SHARED_VALUE
      ? {
        monarchUserId: null, monarchUserName: null, isShared: true, matchType: 'manual',
      }
      : (() => {
        const member = members.find((m) => m.id === select.value);
        return {
          monarchUserId: member?.id ?? null,
          monarchUserName: member?.name ?? null,
          isShared: false,
          matchType: 'manual' as const,
        };
      })();

    if (saveCardholderEntry(integrationId, accountId, cardholderName, updates)) {
      toast.show(
        updates.monarchUserName
          ? `"${cardholderName}" mapped to ${updates.monarchUserName}`
          : `"${cardholderName}" set to ${CARDHOLDER.SHARED_OWNER}`,
        'info',
      );
      if (onRefresh) setTimeout(onRefresh, 300);
    } else {
      toast.show('Failed to update cardholder mapping', 'error');
    }
  });
  select.addEventListener('click', (e: Event) => e.stopPropagation());

  return select;
}

/**
 * Build a single cardholder row.
 */
function createCardholderRow({
  integrationId,
  accountId,
  cardholderName,
  entry,
  members,
  membersAvailable,
  showMemberSelect,
  index,
  onRefresh,
}: {
  integrationId: string;
  accountId: string;
  cardholderName: string;
  entry: CardholderEntry;
  members: HouseholdMember[];
  membersAvailable: boolean;
  showMemberSelect: boolean;
  index: number;
  onRefresh: (() => void) | null;
}): HTMLElement {
  const rowId = entry.cardLast4 || cardholderName.replace(/\s+/g, '-').toLowerCase();

  const row = document.createElement('div');
  row.id = `cardholder-row-${rowId}`;
  row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; '
    + `border-bottom: 1px solid var(--mu-border, #f0f0f0); background: ${index % 2 === 0 ? 'var(--mu-bg-primary, #fff)' : 'var(--mu-bg-secondary, #fafafa)'};`;

  // Identity
  const info = document.createElement('div');
  info.id = `cardholder-info-${rowId}`;
  info.style.cssText = 'flex-grow: 1; min-width: 0;';

  const nameDiv = document.createElement('div');
  nameDiv.style.cssText = 'font-weight: 600; font-size: 13px; color: var(--mu-text-primary, #333);';
  nameDiv.textContent = cardholderName;
  info.appendChild(nameDiv);

  const metaParts: string[] = [];
  if (entry.cardLast4) metaParts.push(`card ••${entry.cardLast4}`);
  if (entry.firstSeen) metaParts.push(`first seen ${entry.firstSeen}`);
  if (metaParts.length > 0) {
    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666); margin-top: 2px;';
    metaDiv.textContent = metaParts.join(' · ');
    info.appendChild(metaDiv);
  }

  row.appendChild(info);

  // Editable tag label
  row.appendChild(createLabelInput(integrationId, accountId, cardholderName, entry));

  // Member mapping (only shown when owner mapping is enabled)
  if (showMemberSelect) {
    if (membersAvailable) {
      row.appendChild(createMemberSelect(integrationId, accountId, cardholderName, entry, members, onRefresh));
    } else {
      const unavailable = document.createElement('span');
      unavailable.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666); font-style: italic;';
      unavailable.textContent = 'Members unavailable';
      row.appendChild(unavailable);
    }
  }

  row.appendChild(createMatchBadge(entry));

  return row;
}

// ── Section ─────────────────────────────────────────────────

/**
 * Build the mode selector rows (owner mapping + cardholder tag).
 */
function createModeSettings(
  integrationId: string,
  accountId: string,
  ownerMode: string,
  tagMode: string,
  onRefresh: (() => void) | null,
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  fragment.appendChild(createToggleSetting({
    id: `cardholder-owner-mode-${accountId}`,
    title: 'Map cardholder to Monarch owner',
    description: 'Sets the transaction Owner. Requires a matching Monarch household member; '
      + `unmapped cardholders use "${CARDHOLDER.SHARED_OWNER}".`,
    isEnabled: ownerMode === CARDHOLDER.OWNER_MODE.ON,
    onChange: (isEnabled) => {
      const value = isEnabled ? CARDHOLDER.OWNER_MODE.ON : CARDHOLDER.OWNER_MODE.OFF;
      const success = accountService.updateAccountInList(integrationId, accountId, {
        [ACCOUNT_SETTINGS.CARDHOLDER_OWNER_MODE]: value,
      });
      if (success) {
        toast.show(`Owner mapping ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        if (onRefresh) setTimeout(onRefresh, 300);
      } else {
        toast.show('Failed to update setting', 'error');
      }
    },
  }));

  fragment.appendChild(createSelectSetting({
    id: `cardholder-tag-mode-${accountId}`,
    title: 'Tag transactions with cardholder',
    description: 'Adds the cardholder label as a Monarch tag. '
      + '"Auto" only tags once two or more cardholders have been detected.',
    options: [
      { value: CARDHOLDER.TAG_MODE.OFF, label: 'Off' },
      { value: CARDHOLDER.TAG_MODE.AUTO, label: 'Auto' },
      { value: CARDHOLDER.TAG_MODE.ALWAYS, label: 'Always' },
    ],
    currentValue: tagMode,
    onChange: (value) => {
      const success = accountService.updateAccountInList(integrationId, accountId, {
        [ACCOUNT_SETTINGS.CARDHOLDER_TAG_MODE]: value,
      });
      if (success) {
        toast.show(`Cardholder tagging set to "${value}"`, 'info');
      } else {
        toast.show('Failed to update setting', 'error');
      }
    },
  }));

  return fragment;
}

/**
 * Render the Cardholders settings section for one account.
 *
 * Returns an empty div when the integration does not declare `hasCardholders`,
 * so callers can append unconditionally.
 *
 * Household members are fetched lazily and only when owner mapping is enabled;
 * a fetch failure leaves existing mappings visible and editable rather than
 * hiding the section.
 *
 * @param integrationId - Integration identifier
 * @param accountEntry - Consolidated account entry
 * @param accountId - Source account ID
 * @param onRefresh - Callback to re-render the settings tab
 */
export function renderCardholderMappingsSection(
  integrationId: string,
  accountEntry: CardholderAccountEntry,
  accountId: string,
  onRefresh: (() => void) | null,
): HTMLElement {
  if (!hasCapability(integrationId, 'hasCardholders')) {
    return document.createElement('div');
  }

  const section = document.createElement('div');
  section.id = `cardholders-section-${integrationId}-${accountId}`;
  section.style.cssText = 'margin-bottom: 15px;';

  const title = document.createElement('h4');
  title.id = `cardholders-title-${integrationId}-${accountId}`;
  title.textContent = 'Cardholders';
  title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  section.appendChild(title);

  const ownerMode = accountEntry.cardholderOwnerMode ?? CARDHOLDER.OWNER_MODE.OFF;
  const tagMode = accountEntry.cardholderTagMode ?? CARDHOLDER.TAG_MODE.OFF;

  section.appendChild(createModeSettings(integrationId, accountId, ownerMode, tagMode, onRefresh));

  // ── Discovered cardholders ────────────────────────────────
  const cardholders = accountEntry.cardholders || {};
  const cardholderNames = Object.keys(cardholders);

  const listContainer = document.createElement('div');
  listContainer.id = `cardholders-list-${integrationId}-${accountId}`;
  listContainer.style.cssText = 'margin-top: 14px;';

  // Sub-header so it's clear the rows below are discovered cardholders and
  // their Monarch mappings, not more settings.
  const listHeader = document.createElement('h5');
  listHeader.id = `cardholders-list-header-${integrationId}-${accountId}`;
  listHeader.textContent = 'Cardholder mapping';
  listHeader.style.cssText = 'margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: var(--mu-text-primary, #333);';
  listContainer.appendChild(listHeader);

  const listHeaderDesc = document.createElement('div');
  listHeaderDesc.id = `cardholders-list-header-desc-${integrationId}-${accountId}`;
  listHeaderDesc.textContent = 'Cardholders detected on this account, their Monarch owner, '
    + 'and the label used when tagging.';
  listHeaderDesc.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666); margin-bottom: 8px;';
  listContainer.appendChild(listHeaderDesc);

  if (cardholderNames.length === 0) {
    const empty = document.createElement('p');
    empty.id = `cardholders-empty-${integrationId}-${accountId}`;
    empty.textContent = 'No cardholders detected yet. They are discovered automatically during sync '
      + 'once owner mapping or cardholder tagging is enabled.';
    empty.style.cssText = 'color: var(--mu-text-secondary, #666); font-style: italic; margin: 0; font-size: 12px;';
    listContainer.appendChild(empty);
    section.appendChild(listContainer);
    return section;
  }

  const list = document.createElement('div');
  list.style.cssText = 'border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px; overflow: hidden;';

  const showMemberSelect = ownerMode === CARDHOLDER.OWNER_MODE.ON;

  // Render synchronously without members first, then enrich once the household
  // fetch resolves. This keeps the settings tab responsive and means a failed
  // fetch still shows the persisted mappings.
  const renderRows = (members: HouseholdMember[], membersAvailable: boolean) => {
    list.textContent = '';
    cardholderNames.forEach((cardholderName, index) => {
      list.appendChild(createCardholderRow({
        integrationId,
        accountId,
        cardholderName,
        entry: cardholders[cardholderName],
        members,
        membersAvailable,
        showMemberSelect,
        index,
        onRefresh,
      }));
    });
  };

  renderRows([], !showMemberSelect);
  listContainer.appendChild(list);
  section.appendChild(listContainer);

  if (showMemberSelect) {
    getHouseholdMembers()
      .then(({ members }) => renderRows(members, true))
      .catch((error) => {
        debugLog('[settingsCardholders] Failed to load Monarch household members:', error);
        renderRows([], false);
      });
  }

  return section;
}

export default {
  renderCardholderMappingsSection,
};