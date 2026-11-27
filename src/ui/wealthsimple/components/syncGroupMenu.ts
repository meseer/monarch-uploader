/**
 * Wealthsimple Sync Group Menu
 * The "⌄" half of the split "Sync All to Monarch" button: a dropdown that runs
 * a bulk sync limited to one account group (Spend & Save or Investing).
 */

import {
  WEALTHSIMPLE_SYNC_GROUPS,
  WEALTHSIMPLE_SYNC_GROUP_LABELS,
  type WealthsimpleSyncGroup,
} from '../../../mappers/wealthsimple-account-types';

/** What each group covers, shown under its menu label */
const SYNC_GROUP_DESCRIPTIONS: Record<WealthsimpleSyncGroup, string> = {
  spendSave: 'Chequing, savings, credit card and line of credit',
  investing: 'Investment accounts, including crypto',
};

/** kebab-case id fragments for each group */
const SYNC_GROUP_ID_SUFFIXES: Record<WealthsimpleSyncGroup, string> = {
  spendSave: 'spend-save',
  investing: 'investing',
};

export interface SyncGroupMenuOptions {
  /** Runs the sync for the group the user picked */
  onSelect: (group: WealthsimpleSyncGroup) => void;
}

export interface SyncGroupMenu {
  /** The "⌄" toggle button, to sit right of the main sync button */
  toggle: HTMLButtonElement;
  /** The dropdown, positioned against the split button's wrapper */
  menu: HTMLDivElement;
  /** Enables or disables the toggle, closing the menu when disabling */
  setDisabled: (disabled: boolean) => void;
}

function createMenuItem(group: WealthsimpleSyncGroup, onPick: () => void): HTMLButtonElement {
  const suffix = SYNC_GROUP_ID_SUFFIXES[group];
  const item = document.createElement('button');
  item.type = 'button';
  item.id = `wealthsimple-sync-group-item-${suffix}`;
  item.setAttribute('role', 'menuitem');
  item.dataset.syncGroup = group;
  item.style.cssText = 'display: block; width: 100%; text-align: left; background: none; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-family: inherit; color: var(--mu-text-primary, #32302f);';

  const label = document.createElement('div');
  label.id = `wealthsimple-sync-group-label-${suffix}`;
  label.textContent = `Sync ${WEALTHSIMPLE_SYNC_GROUP_LABELS[group]} only`;
  label.style.cssText = 'font-size: 14px; font-weight: 500;';

  const description = document.createElement('div');
  description.id = `wealthsimple-sync-group-description-${suffix}`;
  description.textContent = SYNC_GROUP_DESCRIPTIONS[group];
  description.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666); margin-top: 2px;';

  item.append(label, description);
  item.addEventListener('mouseover', () => { item.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)'; });
  item.addEventListener('mouseout', () => { item.style.backgroundColor = 'transparent'; });
  item.addEventListener('click', onPick);
  return item;
}

/**
 * Creates the "⌄" toggle and its group menu. The caller places both inside a
 * `position: relative` wrapper so the menu opens beneath the split button.
 */
export function createSyncGroupMenu({ onSelect }: SyncGroupMenuOptions): SyncGroupMenu {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'wealthsimple-sync-group-toggle-button';
  toggle.textContent = '⌄';
  toggle.title = 'Sync only some accounts';
  toggle.setAttribute('aria-label', 'Choose accounts to sync');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.id = 'wealthsimple-sync-group-menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = 'display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 10000; min-width: 260px; padding: 4px; background-color: var(--mu-bg-primary, white); border: 1px solid var(--mu-border, #e0e0e0); border-radius: 12px; box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 24px;';

  const onOutsideClick = (event: MouseEvent): void => {
    const target = event.target as Node;
    if (!menu.contains(target) && !toggle.contains(target)) close();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  function open(): void {
    menu.style.display = 'block';
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown);
  }

  function close(): void {
    menu.style.display = 'none';
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown);
  }

  WEALTHSIMPLE_SYNC_GROUPS.forEach((group) => {
    menu.appendChild(createMenuItem(group, () => {
      close();
      onSelect(group);
    }));
  });

  toggle.addEventListener('click', () => {
    if (toggle.disabled) return;
    if (menu.style.display === 'none') open(); else close();
  });

  return {
    toggle,
    menu,
    setDisabled: (disabled: boolean) => {
      toggle.disabled = disabled;
      if (disabled) close();
    },
  };
}
