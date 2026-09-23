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

/**
 * Single account page quick-actions block, trimmed to the nesting that matters:
 *
 * #account-actions                    <- UI goes before this, as a sibling
 *   .sc-1ho0ogy-1
 *     button[aria-label=Add money]    <- anchor
 *     button[aria-label=Transfer money]
 *   .sc-8v5wit-0 (Interac, bill pay, ...)
 *   a[aria-label=Find an ATM]
 */
const ACCOUNT_ACTIONS_HTML = `
  <div id="main">
    <div id="account-header"></div>
    <div data-fs-privacy-rule="unmask" class="sc-11fh42v-0 sc-pllw75-0 fjlvcv gwSOE sc-1ho0ogy-0 evIKZU" id="account-actions">
      <div class="sc-11fh42v-0 sc-1ho0ogy-1 cKldvq cIsaKW">
        <button type="button" role="button" aria-label="Add money" class="sc-1ho0ogy-2 Zwtsy"><p>Add money</p></button>
        <button type="button" role="button" aria-label="Transfer money" class="sc-1ho0ogy-2 Zwtsy"><p>Transfer money</p></button>
      </div>
      <div class="sc-11fh42v-0 sc-8v5wit-0 cKldvq bvdGWN">
        <button type="button" role="button" aria-label="Pay a bill" class="sc-8v5wit-1 fMTemu"></button>
      </div>
      <a href="https://maps.example/atm" aria-label="Find an ATM" class="sc-klmq9n-1 fakagj"></a>
    </div>
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

  describe('single account page', () => {
    test('resolves the quick actions block from the Add money anchor', () => {
      document.body.innerHTML = ACCOUNT_ACTIONS_HTML;

      const result = findInjectionPoint();

      expect(result).not.toBeNull();
      expect(result.element).toBe(document.getElementById('account-actions'));
      expect(result.insertMethod).toBe('insertBefore');
      expect(result.selector).toBe('button[aria-label="Add money"]');
    });

    test('falls back to the Transfer money anchor when deposits are unavailable', () => {
      document.body.innerHTML = ACCOUNT_ACTIONS_HTML;
      document.querySelector('button[aria-label="Add money"]').remove();

      const result = findInjectionPoint();

      expect(result.element).toBe(document.getElementById('account-actions'));
      expect(result.selector).toBe('button[aria-label="Transfer money"]');
    });

    test('inserting into the resolved target places the UI above the actions block', () => {
      document.body.innerHTML = ACCOUNT_ACTIONS_HTML;
      const { element, insertMethod } = findInjectionPoint();
      const target = getTargetContainer(element, insertMethod);

      const actions = document.getElementById('account-actions');
      expect(target.container).toBe(actions.parentNode);
      expect(target.referenceNode).toBe(actions);

      const ui = document.createElement('div');
      ui.id = 'wealthsimple-balance-uploader-container';
      target.container.insertBefore(ui, target.referenceNode);

      const main = document.getElementById('main');
      expect(main.children[0]).toBe(document.getElementById('account-header'));
      expect(main.children[1]).toBe(ui);
      expect(main.children[2]).toBe(actions);
    });

    test('holdings anchors take priority when an account page also renders holdings', () => {
      document.body.innerHTML = HOLDINGS_CARD_HTML + ACCOUNT_ACTIONS_HTML;

      const result = findInjectionPoint();

      expect(result.selector).toBe('[role="radiogroup"][aria-label="Holdings or watchlist"]');
    });
  });
});
