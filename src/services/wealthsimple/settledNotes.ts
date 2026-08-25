/**
 * Wealthsimple Settled Notes Utilities
 *
 * Note manipulation helpers used when a pending Wealthsimple transaction settles.
 *
 * The Monarch Notes field is shared between this script and the user: the pending
 * upload writes the `ws-tx:{id}` marker (plus whatever automated note was available
 * at authorization time), and the user may then add their own memo. When the
 * transaction settles, the automated portion must be refreshed WITHOUT discarding
 * the user's content — hence `mergeSettledNotes` rather than a plain overwrite.
 *
 * @module services/wealthsimple/settledNotes
 */

/**
 * Remove Wealthsimple system notes (transaction ID) from notes.
 * Preserves any user-added notes (memo, technical details).
 *
 * @param notes - Raw Monarch notes
 * @returns Notes with the `ws-tx:` / `credit-transaction-` markers stripped
 */
export function cleanSystemNotesFromNotes(notes: string | null | undefined): string {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  let cleaned = notes;

  cleaned = cleaned.replace(/\w+\s*\/\s*ws-tx:[\w-]+/g, '');
  cleaned = cleaned.replace(/ws-tx:[\w-]+/g, '');
  cleaned = cleaned.replace(/\w+\s*\/\s*credit-transaction-[\w-]+/g, '');
  cleaned = cleaned.replace(/credit-transaction-[\w-]+/g, '');

  cleaned = cleaned.replace(/^\s*[/|]\s*/g, '');
  cleaned = cleaned.replace(/\s*[/|]\s*$/g, '');
  cleaned = cleaned.replace(/\n+$/g, '');
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Update dividend notes when a pending dividend settles.
 * Replaces "Upcoming dividend on {symbol}" with "Dividend on {symbol}"
 * and removes the "Expected dividends: ..." line (no longer needed once settled).
 *
 * @param notes - Notes to fix up
 * @returns Notes with the pending dividend phrasing normalized
 */
export function updateSettledDividendNotes(notes: string): string {
  let updated = notes.replace(/^Upcoming dividend on /m, 'Dividend on ');
  updated = updated.replace(/^Expected dividends: .+\n?/m, '');
  // Clean up any resulting double newlines
  updated = updated.replace(/\n{2,}/g, '\n');
  return updated.trim();
}

/**
 * Build a comparison key that identifies an automated note line regardless of the
 * values it carries.
 *
 * Numbers are normalized to `#` and only the label (the text before the first
 * colon) is kept, so a stale pending line matches its settled counterpart even
 * though the values changed:
 *
 * - `Filled 0 @ USD$0, fees: USD$0`  → `filled # @ usd$#, fees`
 * - `Filled 22 @ USD$15, fees: USD$0` → `filled # @ usd$#, fees`
 * - `Dividend on ZHY`                → `dividend on zhy`
 * - `Dividend on ZHY: CAD$2.06`      → `dividend on zhy`
 *
 * @param line - Single note line
 * @returns Normalized key (empty string for blank lines)
 */
function buildLineKey(line: string): string {
  const trimmed = line.trim();
  if (trimmed === '') {
    return '';
  }

  const colonIndex = trimmed.indexOf(':');
  const label = colonIndex > 0 ? trimmed.slice(0, colonIndex) : trimmed;

  return label
    .replace(/\d[\d.,]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Collapse runs of blank lines and trim surrounding whitespace.
 *
 * @param lines - Lines to join
 * @returns Normalized note block
 */
function joinLines(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parameters for mergeSettledNotes */
export interface MergeSettledNotesParams {
  /** Current Monarch notes (already stripped of the `ws-tx:` marker) */
  existingNotes: string;
  /** Automated notes generated for the settled transaction */
  settledNotes: string | null | undefined;
}

/**
 * Merge the settled automated notes into the existing Monarch notes.
 *
 * Existing lines that correspond to an automated line (same normalized label —
 * either the stale pending version or an already-written settled version) are
 * dropped. Everything left over is treated as user-authored content and kept,
 * with the settled automated block appended at the end after a blank line.
 *
 * Keeping the automated block last matches the pending upload layout
 * (`buildWealthsimpleNotes`) and makes the operation idempotent: re-running a
 * sync never duplicates the automated block.
 *
 * @param params - Merge parameters
 * @returns Merged notes ready to send to Monarch
 */
export function mergeSettledNotes({ existingNotes, settledNotes }: MergeSettledNotesParams): string {
  const settledBlock = (settledNotes || '').trim();

  if (!existingNotes || existingNotes.trim() === '') {
    return settledBlock;
  }

  if (!settledBlock) {
    return joinLines(existingNotes.split('\n'));
  }

  const automatedKeys = new Set<string>();
  for (const line of settledBlock.split('\n')) {
    const key = buildLineKey(line);
    if (key) {
      automatedKeys.add(key);
    }
  }

  // Blank lines are kept here and collapsed by joinLines so paragraph breaks in
  // the user's own memo survive.
  const userLines = existingNotes
    .split('\n')
    .filter((line) => {
      const key = buildLineKey(line);
      return key === '' || !automatedKeys.has(key);
    });

  const userNotes = joinLines(userLines);

  if (!userNotes) {
    return settledBlock;
  }

  return `${userNotes}\n\n${settledBlock}`;
}