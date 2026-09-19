/**
 * Progress Dialog - status icon glyph and sizing regression tests
 *
 * A user reported the in-progress icon looking "smaller" than the other status
 * icons in the same row. The cause was font fallback, not CSS: the icon was
 * U+27F3 CLOCKWISE GAPPED CIRCLE ARROW, which lives in Supplemental Arrows-B
 * and is absent from the macOS system UI font. Only 4 fonts on a stock macOS
 * install carry it (Apple Symbols, STIX Two Math, STIXGeneral, .LastResort),
 * versus 142 for U+25CB. It therefore fell out of the page font into Apple
 * Symbols, whose glyph is 0.43em tall against the 0.79em U+25CB it replaces in
 * the same span at the same font-size -- a ~45% drop. U+21BB, from the
 * widely-supported Arrows block, is present in the system UI font at 0.83em.
 *
 * jsdom cannot measure rendered glyphs, so these tests pin what is checkable:
 * the glyph identities, that the regressed codepoint is gone, and that an
 * icon's declared size does not vary with its status. Actual visual size rests
 * on the font-coverage reasoning above, not on CI.
 *
 * This suite uses the real jsdom document on purpose; the main progressDialog
 * suite stubs `document.createElement`, so it cannot observe styles at all.
 */

import { showProgressDialog } from '../../src/ui/components/progressDialog';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

// The four glyphs `getStepIcon` maps onto, by the status that produces them.
const EXPECTED_GLYPH = {
  processing: '↻', // CLOCKWISE OPEN CIRCLE ARROW
  success: '✓', // CHECK MARK
  error: '✗', // BALLOT X
  pending: '○', // WHITE CIRCLE
  skipped: '○',
};

const REGRESSED_GLYPH = '⟳'; // CLOCKWISE GAPPED CIRCLE ARROW -- must not return

describe('Progress Dialog status icons', () => {
  let dialog;

  const accountIcon = () => document.getElementById('balance-uploader-account-icon-acc1');
  const stepIcon = (key) => document.getElementById(`balance-uploader-step-icon-acc1-${key}`);

  beforeEach(() => {
    // jsdom implements no scrolling, and the auto-scroll path calls scrollTo on
    // the account list when a step starts processing. Real browsers have it.
    Element.prototype.scrollTo = jest.fn();
    document.body.innerHTML = '';
    dialog = showProgressDialog([{ key: 'acc1', nickname: 'Joint' }]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('account-level icon glyphs', () => {
    it('starts as the pending circle', () => {
      expect(accountIcon().textContent).toBe(EXPECTED_GLYPH.pending);
    });

    // updateProgress drives the account icon directly while no steps exist.
    it.each(['processing', 'success', 'error', 'pending'])(
      'renders the expected glyph for %s',
      (status) => {
        dialog.updateProgress('acc1', status, 'working');
        expect(accountIcon().textContent).toBe(EXPECTED_GLYPH[status]);
      },
    );

    it('uses the in-progress glyph that is present in the system UI font', () => {
      dialog.updateProgress('acc1', 'processing', 'working');
      expect(accountIcon().textContent).toBe('↻');
      expect(accountIcon().textContent).not.toBe(REGRESSED_GLYPH);
    });
  });

  describe('step-level icon glyphs', () => {
    beforeEach(() => {
      dialog.initSteps('acc1', [{ key: 'balance', name: 'Balance' }]);
    });

    it('starts as the pending circle', () => {
      expect(stepIcon('balance').textContent).toBe(EXPECTED_GLYPH.pending);
    });

    it.each(['processing', 'success', 'error', 'skipped'])(
      'renders the same glyph the account row uses for %s',
      (status) => {
        dialog.updateStepStatus('acc1', 'balance', status, 'msg');
        expect(stepIcon('balance').textContent).toBe(EXPECTED_GLYPH[status]);
      },
    );
  });

  describe('no icon relies on font fallback or emoji presentation', () => {
    // Every status at both levels, collected from the rendered DOM.
    const renderedGlyphs = (d) => {
      const seen = new Set();
      d.initSteps('acc1', [{ key: 'balance', name: 'Balance' }]);
      for (const status of ['processing', 'success', 'error', 'skipped', 'pending']) {
        d.updateStepStatus('acc1', 'balance', status, 'msg');
        seen.add(document.getElementById('balance-uploader-step-icon-acc1-balance').textContent);
        seen.add(document.getElementById('balance-uploader-account-icon-acc1').textContent);
      }
      return [...seen];
    };

    it('never renders U+27F3, which is missing from the system UI font', () => {
      expect(renderedGlyphs(dialog)).not.toContain(REGRESSED_GLYPH);
    });

    it('renders every icon as a single codepoint with no variation selector', () => {
      // A U+FE0F selector would invite colour-emoji rendering and a fresh set of
      // platform inconsistencies.
      for (const glyph of renderedGlyphs(dialog)) {
        expect([...glyph]).toHaveLength(1);
        const cps = [...glyph].map((c) => c.codePointAt(0));
        expect(cps).not.toContain(0xFE0F); // emoji presentation selector
        expect(cps).not.toContain(0xFE0E); // text presentation selector
      }
    });

    it('draws every icon from the Arrows, Dingbats or Geometric Shapes blocks', () => {
      // These three blocks are carried by ordinary UI fonts. Supplemental
      // Arrows-B (U+2900-U+297F) and the emoji planes are not, and a codepoint
      // from those would fall back to a symbol font with mismatched metrics.
      for (const glyph of renderedGlyphs(dialog)) {
        const cp = glyph.codePointAt(0);
        const inArrows = cp >= 0x2190 && cp <= 0x21FF;
        const inDingbats = cp >= 0x2700 && cp <= 0x27BF;
        const inGeometric = cp >= 0x25A0 && cp <= 0x25FF;
        expect(inArrows || inDingbats || inGeometric).toBe(true);
      }
    });
  });

  describe('declared icon size does not vary with status', () => {
    // The reported symptom was one status looking smaller than the others in the
    // same span. Guards against "fixing" that by special-casing a glyph's size.
    it('keeps the account icon font-size fixed across every status', () => {
      const sizes = new Set();
      for (const status of ['pending', 'processing', 'success', 'error']) {
        dialog.updateProgress('acc1', status, 'working');
        sizes.add(accountIcon().style.fontSize);
      }
      expect([...sizes]).toEqual(['1.2em']);
    });

    it('keeps the step icon font-size fixed across every status', () => {
      dialog.initSteps('acc1', [{ key: 'balance', name: 'Balance' }]);
      const sizes = new Set();
      for (const status of ['pending', 'processing', 'success', 'error', 'skipped']) {
        dialog.updateStepStatus('acc1', 'balance', status, 'msg');
        sizes.add(stepIcon('balance').style.fontSize);
      }
      expect(sizes.size).toBe(1);
    });
  });

  describe('getStepColor colouring is preserved', () => {
    it('recolours the account icon per status', () => {
      dialog.updateProgress('acc1', 'processing', 'working');
      const processing = accountIcon().style.color;
      dialog.updateProgress('acc1', 'error', 'boom');
      const error = accountIcon().style.color;

      expect(processing).toBeTruthy();
      expect(error).toBeTruthy();
      expect(processing).not.toBe(error);
    });

    it('recolours the step icon per status', () => {
      dialog.initSteps('acc1', [{ key: 'balance', name: 'Balance' }]);
      dialog.updateStepStatus('acc1', 'balance', 'success', 'ok');
      const success = stepIcon('balance').style.color;
      dialog.updateStepStatus('acc1', 'balance', 'error', 'boom');
      const error = stepIcon('balance').style.color;

      expect(success).toBeTruthy();
      expect(error).toBeTruthy();
      expect(success).not.toBe(error);
    });
  });
});
