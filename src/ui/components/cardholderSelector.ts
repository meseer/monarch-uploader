/**
 * Cardholder Selector Component
 *
 * Prompts the user to map an institution cardholder to a Monarch household
 * member (or "Shared"). Shown once per newly discovered cardholder when owner
 * mapping is enabled.
 *
 * The best automatic match is pre-selected and visibly labelled, so the common
 * case (institution name matches the Monarch member name) is a single
 * confirmation rather than a decision.
 *
 * @module ui/components/cardholderSelector
 */

import { debugLog } from '../../core/utils';
import { CARDHOLDER } from '../../core/config';
import { addModalKeyboardHandlers } from '../keyboardNavigation';
import { describeMatchType, type CardholderMatchType } from '../../services/common/cardholderMatching';
import type { HouseholdMember } from '../../api/monarchHousehold';

// ── Types ───────────────────────────────────────────────────

/** Parameters for showCardholderSelector */
export interface CardholderSelectorParams {
  /** Raw institution cardholder name (e.g. "MYKHAILO DELEGAN") */
  cardholderName: string;
  /** Last 4 digits of the card, when known */
  cardLast4: string | null;
  /** Monarch household members to choose from */
  members: HouseholdMember[];
  /** Member id to pre-select, or null to pre-select "Shared" */
  suggestedMemberId: string | null;
  /** How the suggestion was derived (used for the explanatory badge) */
  suggestedMatchType: CardholderMatchType | null;
}

/** The user's choice */
export interface CardholderSelectorResult {
  /** Selected member, or null when "Shared" was chosen */
  member: HouseholdMember | null;
}

/** Sentinel option value representing "Shared" (no specific owner) */
const SHARED_VALUE = '__shared__';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Build the subtitle describing which cardholder is being mapped.
 * e.g. "MYKHAILO DELEGAN · card ••8584"
 */
function buildCardholderSubtitle(cardholderName: string, cardLast4: string | null): string {
  return cardLast4 ? `${cardholderName} · card ••${cardLast4}` : cardholderName;
}

/**
 * Create a single selectable option row.
 */
function createOptionRow({
  id, value, label, sublabel, isSuggested,
}: {
  id: string;
  value: string;
  label: string;
  sublabel: string | null;
  isSuggested: boolean;
}): HTMLLabelElement {
  const row = document.createElement('label');
  row.id = id;
  row.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    background: var(--mu-bg-primary, #fff);
    transition: background-color 0.2s;
  `;

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'cardholder-member';
  radio.value = value;
  radio.checked = isSuggested;
  radio.style.cssText = 'margin: 0; flex-shrink: 0;';
  row.appendChild(radio);

  const textWrapper = document.createElement('div');
  textWrapper.style.cssText = 'flex-grow: 1; min-width: 0;';

  const labelDiv = document.createElement('div');
  labelDiv.style.cssText = 'font-weight: 500; font-size: 14px; color: var(--mu-text-primary, #333);';
  labelDiv.textContent = label;
  textWrapper.appendChild(labelDiv);

  if (sublabel) {
    const sublabelDiv = document.createElement('div');
    sublabelDiv.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666); margin-top: 2px;';
    sublabelDiv.textContent = sublabel;
    textWrapper.appendChild(sublabelDiv);
  }

  row.appendChild(textWrapper);

  if (isSuggested) {
    const badge = document.createElement('span');
    badge.style.cssText = `
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--mu-badge-bg, #e3f2fd);
      color: var(--mu-badge-text, #1565c0);
    `;
    badge.textContent = 'Suggested';
    row.appendChild(badge);
  }

  row.addEventListener('mouseover', () => {
    row.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  row.addEventListener('mouseout', () => {
    row.style.backgroundColor = 'var(--mu-bg-primary, #fff)';
  });

  return row;
}

/**
 * Create a styled action button.
 */
function createActionButton(id: string, text: string, isPrimary: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.textContent = text;

  if (isPrimary) {
    btn.style.cssText = `
      padding: 10px 20px; background-color: #28a745; color: white;
      border: none; border-radius: 4px; cursor: pointer;
      font-size: 0.95em; font-weight: bold; transition: background-color 0.2s;
    `;
    btn.addEventListener('mouseover', () => { btn.style.backgroundColor = '#218838'; });
    btn.addEventListener('mouseout', () => { btn.style.backgroundColor = '#28a745'; });
  } else {
    btn.style.cssText = `
      padding: 10px 20px; background-color: var(--mu-bg-tertiary, #f5f5f5);
      color: var(--mu-text-primary, #333); border: none; border-radius: 4px;
      cursor: pointer; font-size: 0.95em; transition: background-color 0.2s;
    `;
    btn.addEventListener('mouseover', () => { btn.style.backgroundColor = 'var(--mu-hover-bg, #e0e0e0)'; });
    btn.addEventListener('mouseout', () => { btn.style.backgroundColor = 'var(--mu-bg-tertiary, #f5f5f5)'; });
  }

  return btn;
}

// ── Component ───────────────────────────────────────────────

/**
 * Show the cardholder → household member mapping prompt.
 *
 * Options are "Shared" plus every Monarch household member. The best automatic
 * match is pre-selected; when nothing matched, "Shared" is pre-selected.
 *
 * Cancelling (button or Escape) resolves with `null`, which the caller treats as
 * "not mapped this sync, ask again next time" rather than persisting a choice.
 *
 * @returns The user's selection, or null if cancelled
 */
export function showCardholderSelector({
  cardholderName,
  cardLast4,
  members,
  suggestedMemberId,
  suggestedMatchType,
}: CardholderSelectorParams): Promise<CardholderSelectorResult | null> {
  return new Promise((resolve) => {
    let cleanupKeyboard = () => {};

    const overlay = document.createElement('div');
    overlay.id = 'cardholder-selector-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-color: var(--mu-overlay-bg, rgba(0, 0, 0, 0.5));
      display: flex; justify-content: center; align-items: center; z-index: 10000;
    `;

    const modal = document.createElement('div');
    modal.id = 'cardholder-selector-modal';
    modal.style.cssText = `
      background: var(--mu-bg-primary, white);
      color: var(--mu-text-primary, #333);
      padding: 25px; border-radius: 8px;
      width: 90%; max-width: 480px;
      max-height: 85vh; overflow-y: auto;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;

    // ── Header ──────────────────────────────────────────────
    const header = document.createElement('div');
    header.id = 'cardholder-selector-header';
    header.style.cssText = 'margin-bottom: 18px;';

    const title = document.createElement('h3');
    title.id = 'cardholder-selector-title';
    title.textContent = 'Who is this cardholder?';
    title.style.cssText = 'margin: 0 0 6px 0; font-size: 18px; color: var(--mu-text-primary, #333);';
    header.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.id = 'cardholder-selector-subtitle';
    subtitle.textContent = buildCardholderSubtitle(cardholderName, cardLast4);
    subtitle.style.cssText = 'font-size: 13px; font-weight: 500; color: var(--mu-text-secondary, #666);';
    header.appendChild(subtitle);

    const explanation = document.createElement('div');
    explanation.id = 'cardholder-selector-explanation';
    explanation.textContent = 'Transactions from this card will be assigned to the selected Monarch member. '
      + 'Choose Shared if this cardholder is not a member of your Monarch household.';
    explanation.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666); margin-top: 8px; line-height: 1.4;';
    header.appendChild(explanation);

    modal.appendChild(header);

    // ── Options ─────────────────────────────────────────────
    const optionsContainer = document.createElement('div');
    optionsContainer.id = 'cardholder-selector-options';
    optionsContainer.style.cssText = 'margin-bottom: 20px;';

    const hasSuggestion = Boolean(suggestedMemberId);

    // "Shared" is always the first option; pre-selected when nothing matched.
    optionsContainer.appendChild(createOptionRow({
      id: 'cardholder-option-shared',
      value: SHARED_VALUE,
      label: CARDHOLDER.SHARED_OWNER,
      sublabel: 'No specific owner',
      isSuggested: !hasSuggestion,
    }));

    members.forEach((member) => {
      const isSuggested = member.id === suggestedMemberId;
      // Show the display name as a sublabel only when it differs from the full
      // name, plus the reason this row was suggested.
      const sublabelParts: string[] = [];
      if (member.displayName && member.displayName !== member.name) {
        sublabelParts.push(member.displayName);
      }
      if (isSuggested && suggestedMatchType) {
        sublabelParts.push(describeMatchType(suggestedMatchType));
      }

      optionsContainer.appendChild(createOptionRow({
        id: `cardholder-option-${member.id}`,
        value: member.id,
        label: member.name,
        sublabel: sublabelParts.length > 0 ? sublabelParts.join(' · ') : null,
        isSuggested,
      }));
    });

    modal.appendChild(optionsContainer);

    // ── Actions ─────────────────────────────────────────────
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'cardholder-selector-buttons';
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const close = (result: CardholderSelectorResult | null) => {
      cleanupKeyboard();
      overlay.remove();
      resolve(result);
    };

    const cancelBtn = createActionButton('cardholder-selector-cancel-button', 'Cancel', false);
    cancelBtn.addEventListener('click', () => {
      debugLog(`[cardholderSelector] Cancelled mapping for "${cardholderName}"`);
      close(null);
    });
    buttonContainer.appendChild(cancelBtn);

    const confirmBtn = createActionButton('cardholder-selector-confirm-button', 'Confirm', true);
    confirmBtn.addEventListener('click', () => {
      const selected = optionsContainer.querySelector<HTMLInputElement>('input[name="cardholder-member"]:checked');
      const value = selected?.value ?? SHARED_VALUE;

      if (value === SHARED_VALUE) {
        debugLog(`[cardholderSelector] "${cardholderName}" mapped to Shared`);
        close({ member: null });
        return;
      }

      const member = members.find((m) => m.id === value) || null;
      debugLog(`[cardholderSelector] "${cardholderName}" mapped to "${member?.name}"`);
      close({ member });
    });
    buttonContainer.appendChild(confirmBtn);

    modal.appendChild(buttonContainer);

    // Escape / overlay click cancels, matching other modals in the project
    const cleanupModalHandlers = addModalKeyboardHandlers(overlay, () => close(null));
    cleanupKeyboard = () => cleanupModalHandlers();

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    confirmBtn.focus();
  });
}

export default {
  showCardholderSelector,
};
