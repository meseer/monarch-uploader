/**
 * Wealthsimple Sync Group Menu
 * The chevron half of the split "Sync All to Monarch" button: a dropdown that runs
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
  /** The chevron toggle button, to sit right of the main sync button */
  toggle: HTMLButtonElement;
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

/** Gap between the split button and the menu, and the viewport margin it keeps */
const MENU_OFFSET_PX = 4;

/**
 * A chevron drawn as SVG rather than the "⌄" glyph, which sits high in the
 * font's line box and cannot be centred reliably.
 */
function createChevronIcon(): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.id = 'wealthsimple-sync-group-toggle-icon';
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display: block; transition: transform 0.2s ease;';
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', 'M4 6l4 4 4-4');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.75');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/**
 * Place the menu under the anchor, left-aligned with it, flipping above when
 * there is no room below. Coordinates are fixed, i.e. viewport-relative.
 */
function positionMenu(menu: HTMLDivElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  const menuHeight = menu.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUpward = menuHeight + MENU_OFFSET_PX > spaceBelow && rect.top > spaceBelow;
  const top = openUpward ? rect.top - menuHeight - MENU_OFFSET_PX : rect.bottom + MENU_OFFSET_PX;
  const maxLeft = window.innerWidth - menu.offsetWidth - MENU_OFFSET_PX;
  menu.style.top = `${Math.max(MENU_OFFSET_PX, top)}px`;
  menu.style.left = `${Math.max(MENU_OFFSET_PX, Math.min(rect.left, maxLeft))}px`;
}

/**
 * Creates the "⌄" toggle and its group menu.
 *
 * The menu is attached to document.body while open, with fixed positioning,
 * because Wealthsimple's cards clip overflow and create stacking contexts
 * that would hide it behind the content below our card.
 */
export function createSyncGroupMenu({ onSelect }: SyncGroupMenuOptions): SyncGroupMenu {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'wealthsimple-sync-group-toggle-button';
  toggle.title = 'Sync only some accounts';
  toggle.setAttribute('aria-label', 'Choose accounts to sync');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  const chevron = createChevronIcon();
  toggle.appendChild(chevron);

  const menu = document.createElement('div');
  menu.id = 'wealthsimple-sync-group-menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = 'position: fixed; z-index: 2147483000; min-width: 260px; padding: 4px; background-color: var(--mu-bg-primary, white); border: 1px solid var(--mu-border, #e0e0e0); border-radius: 12px; box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 24px; font-family: "Wealthsimple Sans", sans-serif; box-sizing: border-box;';

  const isOpen = (): boolean => menu.isConnected;
  const onOutsideClick = (event: MouseEvent): void => {
    const target = event.target as Node;
    if (!menu.contains(target) && !toggle.contains(target)) close();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  // A fixed menu would drift from the button, so close rather than follow
  const onViewportChange = (): void => close();

  function open(): void {
    document.body.appendChild(menu);
    positionMenu(menu, toggle.parentElement ?? toggle);
    toggle.setAttribute('aria-expanded', 'true');
    chevron.style.transform = 'rotate(180deg)';
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
  }

  function close(): void {
    menu.remove();
    toggle.setAttribute('aria-expanded', 'false');
    chevron.style.transform = '';
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
  }

  WEALTHSIMPLE_SYNC_GROUPS.forEach((group) => {
    menu.appendChild(createMenuItem(group, () => {
      close();
      onSelect(group);
    }));
  });

  toggle.addEventListener('click', () => {
    if (toggle.disabled) return;
    if (isOpen()) close(); else open();
  });

  return {
    toggle,
    setDisabled: (disabled: boolean) => {
      toggle.disabled = disabled;
      if (disabled) close();
    },
  };
}
