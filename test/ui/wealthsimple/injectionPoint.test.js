/**
 * @jest-environment jsdom
 *
 * Exercises the real injection-point resolution against a fixture that mirrors
 * the Wealthsimple dashboard holdings card (hashed class names included, since
 * the point of the anchor+ancestorLevels approach is to ignore them).
 */

import { findInjectionPoint, getTargetContainer } from '../../../src/ui/wealthsimple/uiManager';

global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

/**
 * Holdings card markup, trimmed to the nesting that matters:
 *
 * #holdings-card                      <- expected injection target
 *   .sc-bdu1qd-0                      <- first child, UI goes before it
 *     [data-fs-privacy-rule=unmask]
 *       .havugw
 *         .jzwpvl > [role=radiogroup] <- anchor
 *         .XzifF > [data-testid=holdings-dashboard-link]
 */
const HOLDINGS_CARD_HTML = `
  <div id="main">
    <div class="sc-11fh42v-0 sc-7iuj6s-1 bOtRXv iWCvbV" id="holdings-card">
      <div class="sc-bdu1qd-0 gsajX sc-12p70xj-0 izxjxv" id="card-body">
        <div data-fs-privacy-rule="unmask" class="sc-1lb5pyn-0 jKDQfz">
          <div class="sc-1lb5pyn-0 havugw">
            <div class="sc-1lb5pyn-0 jzwpvl">
              <div role="radiogroup" aria-label="Holdings or watchlist" class="sc-1prho08-0 fUuMRj">
                <button type="button" role="radio" aria-checked="true">Holdings</button>
                <button type="button" role="radio" aria-checked="false">Watchlist</button>
              </div>
            </div>
            <div class="sc-1lb5pyn-0 XzifF">
              <a aria-label="View all holdings" data-testid="holdings-dashboard-link" href="/app/holdings-dashboard"></a>
            </div>
          </div>
          <div class="sc-1lb5pyn-0 gYmIMb">
            <div class="sc-iono4k-0 cWqYjO">
              <div data-testid="holdings-home-list"><ul role="list"></ul></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="sc-11fh42v-0 sc-7iuj6s-2 cKldvq ghXgVe" id="earnings-card"></div>
  </div>
`;

describe('Wealthsimple injection point resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('findInjectionPoint', () => {
    test('resolves the holdings card from the Holdings/Watchlist toggle anchor', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;

      const result = findInjectionPoint();

      expect(result).not.toBeNull();
      expect(result.element).toBe(document.getElementById('holdings-card'));
      expect(result.insertMethod).toBe('prepend');
      expect(result.selector).toBe('[role="radiogroup"][aria-label="Holdings or watchlist"]');
    });

    test('falls back to the holdings dashboard link when the toggle is absent', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;
      document.querySelector('[role="radiogroup"]').remove();

      const result = findInjectionPoint();

      expect(result.element).toBe(document.getElementById('holdings-card'));
      expect(result.selector).toBe('[data-testid="holdings-dashboard-link"]');
    });

    test('falls back to the legacy hashed-class anchor when no holdings card exists', () => {
      const legacy = document.createElement('div');
      legacy.className = 'kOjAGq';
      document.body.appendChild(legacy);

      const result = findInjectionPoint();

      expect(result.element).toBe(legacy);
      expect(result.selector).toBe('last:.kOjAGq');
    });

    test('returns null when no injection point is present', () => {
      document.body.innerHTML = '<div id="main"><p>Nothing to anchor on</p></div>';

      expect(findInjectionPoint()).toBeNull();
    });

    test('skips an anchor whose ancestor walk escapes the layout', () => {
      // Anchor sits directly under body, so climbing 5 levels is impossible.
      document.body.innerHTML = '<div role="radiogroup" aria-label="Holdings or watchlist"></div>';

      expect(findInjectionPoint()).toBeNull();
    });

    test('prefers a shallower anchor over a legacy fallback that also matches', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;
      const legacy = document.createElement('div');
      legacy.className = 'kOjAGq';
      document.body.appendChild(legacy);

      const result = findInjectionPoint();

      expect(result.element).toBe(document.getElementById('holdings-card'));
    });
  });

  describe('getTargetContainer with the resolved holdings card', () => {
    test('prepend targets the card itself with no reference node', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;
      const { element, insertMethod } = findInjectionPoint();

      const target = getTargetContainer(element, insertMethod);

      expect(target.container).toBe(document.getElementById('holdings-card'));
      expect(target.referenceNode).toBeNull();
    });

    test('inserting into the resolved target lands above the holdings toggle', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;
      const { element, insertMethod } = findInjectionPoint();
      const target = getTargetContainer(element, insertMethod);

      const ui = document.createElement('div');
      ui.id = 'wealthsimple-balance-uploader-container';
      target.container.insertBefore(ui, target.referenceNode ?? target.container.firstChild);

      const card = document.getElementById('holdings-card');
      expect(card.firstElementChild).toBe(ui);
      expect(card.children[1]).toBe(document.getElementById('card-body'));
      // Our UI precedes the toggle in document order.
      const toggle = document.querySelector('[role="radiogroup"]');
      expect(ui.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('returns null for insertBefore when the resolved element has no parent', () => {
      const orphan = document.createElement('div');

      expect(getTargetContainer(orphan, 'insertBefore')).toBeNull();
    });

    test('returns null for an unknown insert method', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML;

      expect(getTargetContainer(document.getElementById('holdings-card'), 'teleport')).toBeNull();
    });
  });
});
