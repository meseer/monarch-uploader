/**
 * Settings Modal - Collapsible Section Helpers
 *
 * Small presentation helpers shared by the collapsible sections inside an
 * account card (uploaded transactions, holdings mappings). Extracted so both
 * `settingsModalAccountCards` and `settingsModalTransactions` can use them
 * without a lateral dependency between those two modules.
 */

/** A collapsible header and its expand/collapse chevron */
export interface CollapsibleHeader {
  header: HTMLElement;
  expandIcon: HTMLSpanElement;
}

/**
 * Create a collapsible section header with a chevron, title and count label.
 *
 * @param idPrefix - Namespace for the generated element IDs (kebab-case)
 * @param title - Section title text
 * @param countText - Secondary label, typically an item count
 */
export function createCollapsibleHeader(
  idPrefix: string,
  title: string,
  countText: string,
): CollapsibleHeader {
  const sectionHeader = document.createElement('div');
  sectionHeader.id = `${idPrefix}-header`;
  sectionHeader.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; background-color: var(--mu-bg-primary, #fff);
    border: 1px solid var(--mu-border, #e0e0e0); border-radius: 6px;
    cursor: pointer; transition: background-color 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const expandIcon = document.createElement('span');
  expandIcon.id = `${idPrefix}-expand-icon`;
  expandIcon.textContent = '▼';
  expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px; transform: rotate(270deg);';
  headerLeft.appendChild(expandIcon);

  const headerTitle = document.createElement('h4');
  headerTitle.textContent = title;
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  headerLeft.appendChild(headerTitle);

  const countSpan = document.createElement('span');
  countSpan.id = `${idPrefix}-count`;
  countSpan.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666);';
  countSpan.textContent = countText;
  headerLeft.appendChild(countSpan);

  sectionHeader.appendChild(headerLeft);

  return { header: sectionHeader, expandIcon };
}

/**
 * Wire up expand/collapse and hover behaviour for a collapsible section.
 *
 * @param headerResult - Result of `createCollapsibleHeader`
 * @param expandableContent - Element toggled by the header
 */
export function setupCollapsible(
  headerResult: CollapsibleHeader,
  expandableContent: HTMLElement,
): void {
  let isExpanded = false;
  headerResult.header.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    expandableContent.style.display = isExpanded ? 'block' : 'none';
    headerResult.expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
  });

  headerResult.header.addEventListener('mouseover', () => {
    headerResult.header.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  headerResult.header.addEventListener('mouseout', () => {
    headerResult.header.style.backgroundColor = 'var(--mu-bg-primary, #fff)';
  });
}

/**
 * Create a small styled button used in collapsible section toolbars.
 *
 * @param id - Element ID (kebab-case)
 * @param text - Button label
 * @param color - Accent colour; omit for the neutral style
 * @param isOutline - Render the accent colour as an outline rather than a fill
 */
export function createSmallButton(
  id: string,
  text: string,
  color?: string,
  isOutline?: boolean,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;

  if (color && !isOutline) {
    btn.style.cssText = `padding: 5px 10px; border: none; border-radius: 4px; background: ${color}; color: white; cursor: pointer; font-size: 12px;`;
  } else if (color && isOutline) {
    btn.style.cssText = `padding: 5px 10px; border: 1px solid ${color}; border-radius: 4px; background: var(--mu-bg-primary, white); color: ${color}; cursor: pointer; font-size: 12px;`;
  } else {
    btn.style.cssText = 'padding: 5px 10px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; background: var(--mu-bg-primary, white); color: var(--mu-text-primary, #333); cursor: pointer; font-size: 12px;';
  }

  return btn;
}