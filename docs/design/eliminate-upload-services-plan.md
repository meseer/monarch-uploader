# Plan: Eliminate Per-Integration Upload Services (Part D)

## Goal

Eliminate `src/services/mbna-upload.js` by generalizing its remaining logic into:
1. A **generic account mapping resolver** (`services/common/accountMappingResolver.js`)
2. A **generic pre-sync orchestrator** (extend `syncOrchestrator.js`)
3. New **manifest fields** and an optional **SyncHook** for first-sync date suggestion

Once built, the UI manager calls the generic flow directly — no per-institution upload service needed.

---

## What Remains in `mbna-upload.js` (238 lines)

| Function | Lines | Responsibility | Generic? |
|---|---|---|---|
| `syncMbnaAccount()` | ~25 | Create progress dialog, call `syncAccount()` | ✅ Trivially generic |
| `uploadMbnaAccount()` | ~120 | Account mapping, skip handling, logo, date selection, then sync | ⚠️ Needs generalization |
| `isFirstSync()` | ~3 | Check `getLastUpdateDate()` | ✅ Already generic |

### Breakdown of `uploadMbnaAccount()` Logic

| Step | Lines | Institution-specific part | Solution |
|---|---|---|---|
| Get display name | 2 | Fallback format `MBNA Card (${endingIn})` | New manifest field: `buildDisplayName` or convention |
| Check existing mapping | 3 | None | Already generic via `accountService` |
| Check if skipped | 5 | None | Already generic |
| Show account selector | 10 | `createDefaults` type/subtype | New manifest field: `accountCreateDefaults` |
| Handle cancel/skip | 20 | Shape of stored account data | New hook: `buildAccountStorageEntry(account)` |
| Save mapping | 10 | Shape of stored account data | Same hook |
| Set logo | 5 | Cloudinary ID | Already in manifest: `logoCloudinaryId` |
| First-sync date suggestion | 15 | Calls `api.getClosingDates()` | New optional hook: `suggestStartDate` |
| Date picker | 10 | Prompt text, reconstruct checkbox | Manifest capabilities drive this |
| Lookback calculation | 5 | None | Already generic |

---

## New Components

### 1. Manifest Additions

```js
// In manifest.js
{
  // ... existing fields ...

  // Account creation defaults for Monarch account selector
  accountCreateDefaults: {
    type: 'credit',
    subtype: 'credit_card',
    accountType: 'credit',         // filter for selector
  },

  // How to build account display name from raw account object
  // Convention: manifest provides a function or the UI manager passes displayName
  // Decision: UI manager already computes displayName — pass it through
}
```

### 2. New SyncHooks (Optional)

```js
/**
 * Suggest a start date for first sync.
 * @param {Object} api - Integration API client
 * @param {string} accountId - Source account ID
 * @returns {Promise<{date: string, description: string}|null>}
 */
suggestStartDate: async (api, accountId) => {
  // MBNA: fetch closing dates, return 30 days before oldest
  // Rogers: return openedDate
  // Others: return null (use default 90 days ago)
}

/**
 * Build the institution-specific portion of the account storage entry.
 * @param {Object} account - Raw account from source API
 * @returns {Object} Fields to store under manifest.accountKeyName
 */
buildAccountEntry: (account) => {
  // MBNA: { id, endingIn, cardName, nickname }
  // Rogers: { id, nickname }
  // Canada Life: { id, nickname, agreementId, ... }
}
```

### 3. Generic Account Mapping Resolver (`services/common/accountMappingResolver.js`)

~100 lines. Handles the entire account mapping flow generically:

```js
/**
 * Resolve Monarch account mapping for any integration.
 *
 * @param {Object} params
 * @param {string} params.integrationId
 * @param {Object} params.manifest - Integration manifest
 * @param {Object} params.account - Raw source account
 * @param {string} params.accountDisplayName - Display name
 * @param {Function} params.buildAccountEntry - Hook to build source account storage shape
 * @returns {Promise<{monarchAccount, skipped, cancelled}>}
 */
export async function resolveAccountMapping({
  integrationId, manifest, account, accountDisplayName, buildAccountEntry,
}) {
  const accountId = account.accountId;

  // 1. Check existing mapping
  const existing = accountService.getMonarchAccountMapping(integrationId, accountId);
  if (existing) return { monarchAccount: existing };

  // 2. Check if skipped
  const accountData = accountService.getAccountData(integrationId, accountId);
  if (accountData?.syncEnabled === false) return { skipped: true };

  // 3. Show account selector with manifest-driven defaults
  const createDefaults = {
    defaultName: accountDisplayName,
    ...manifest.accountCreateDefaults,
  };

  const monarchAccount = await new Promise((resolve) => {
    showMonarchAccountSelectorWithCreate(
      [], resolve, null,
      manifest.accountCreateDefaults?.accountType || 'credit',
      createDefaults,
    );
  });

  if (!monarchAccount) return { cancelled: true };
  if (monarchAccount.cancelled) return { cancelled: true };

  // 4. Handle skip
  if (monarchAccount.skipped) {
    const skippedData = {
      [manifest.accountKeyName]: buildAccountEntry(account),
      monarchAccount: null,
      syncEnabled: false,
      lastSyncDate: null,
    };
    accountService.upsertAccount(integrationId, skippedData);
    toast.show(`${accountDisplayName}: skipped`, 'info', 2000);
    return { skipped: true };
  }

  // 5. Save mapping
  const mappingData = {
    [manifest.accountKeyName]: buildAccountEntry(account),
    monarchAccount: { id: monarchAccount.id, displayName: monarchAccount.displayName },
    syncEnabled: true,
    lastSyncDate: null,
  };
  accountService.upsertAccount(integrationId, mappingData);
  toast.show(`Mapped: ${accountDisplayName} → ${monarchAccount.displayName}`, 'success', 3000);

  // 6. Set logo on newly created accounts
  if (monarchAccount.newlyCreated && manifest.logoCloudinaryId) {
    try {
      await monarchApi.setAccountLogo(monarchAccount.id, manifest.logoCloudinaryId);
    } catch (error) {
      debugLog(`[${integrationId}] Failed to set account logo:`, error.message);
    }
  }

  return { monarchAccount };
}
```

### 4. Generic Pre-Sync + Sync Entry Point (`prepareAndSync` in `syncOrchestrator.js`)

~80 lines added to the existing orchestrator:

```js
/**
 * Full upload flow: resolve mapping → determine dates → create progress dialog → sync.
 *
 * @param {Object} params
 * @param {string} params.integrationId
 * @param {Object} params.manifest
 * @param {SyncHooks} params.hooks
 * @param {Object} params.api
 * @param {Object} params.account - Raw source account with accountId
 * @param {string} params.accountDisplayName
 * @returns {Promise<{success, message, skipped?}>}
 */
export async function prepareAndSyncAccount({
  integrationId, manifest, hooks, api, account, accountDisplayName,
}) {
  // 1. Resolve account mapping
  const mappingResult = await resolveAccountMapping({
    integrationId, manifest, account, accountDisplayName,
    buildAccountEntry: hooks.buildAccountEntry,
  });

  if (mappingResult.skipped) return { success: true, message: 'Skipped', skipped: true };
  if (mappingResult.cancelled) return { success: false, message: 'Cancelled' };
  const { monarchAccount } = mappingResult;

  // 2. Determine date range
  const firstSync = !getLastUpdateDate(account.accountId, integrationId);
  let fromDate, reconstructBalance = false;

  if (firstSync) {
    // Get suggested start date from hook (if provided)
    let defaultDate;
    if (hooks.suggestStartDate) {
      const suggestion = await hooks.suggestStartDate(api, account.accountId);
      if (suggestion) {
        defaultDate = suggestion.date;
      }
    }
    if (!defaultDate) {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      defaultDate = d.toISOString().split('T')[0];
    }

    const showReconstruct = manifest.capabilities?.hasBalanceReconstruction === true;
    const datePickerResult = await showDatePickerWithOptionsPromise(
      defaultDate,
      `Select the start date for syncing "${accountDisplayName}".`,
      { showReconstructCheckbox: showReconstruct, reconstructCheckedByDefault: showReconstruct },
    );

    if (!datePickerResult) return { success: false, message: 'Date selection cancelled' };
    fromDate = datePickerResult.date;
    reconstructBalance = datePickerResult.reconstructBalance;
  } else {
    fromDate = calculateFromDateWithLookback(integrationId, account.accountId) || (() => {
      const d = new Date(); d.setDate(d.getDate() - 14);
      return d.toISOString().split('T')[0];
    })();
  }

  // 3. Set state + create progress dialog
  stateManager.setAccount(account.accountId, accountDisplayName);
  const progressDialog = showProgressDialog(
    [{ key: account.accountId, nickname: accountDisplayName, name: `${manifest.displayName} Upload` }],
    `Syncing ${manifest.displayName} Data to Monarch Money`,
  );

  // 4. Run sync
  return syncAccount({
    integrationId, manifest, hooks, api, account, accountDisplayName,
    monarchAccount, fromDate, reconstructBalance, firstSync, progressDialog,
  });
}
```

### 5. MBNA SyncHooks Additions

Add two new hooks to the existing `syncHooks.js`:

```js
// In integrations/mbna/sinks/monarch/syncHooks.js

async function suggestStartDate(api, accountId) {
  try {
    const closingDates = await api.getClosingDates(accountId);
    if (closingDates.length > 0) {
      const oldest = closingDates[closingDates.length - 1];
      const d = new Date(`${oldest}T00:00:00`);
      d.setDate(d.getDate() - 30);
      return { date: d.toISOString().split('T')[0], description: '30 days before oldest statement' };
    }
  } catch (error) { /* fall through */ }
  return null;
}

function buildAccountEntry(account) {
  return {
    id: account.accountId,
    endingIn: account.endingIn,
    cardName: account.cardName,
    nickname: account.displayName || `MBNA Card (${account.endingIn})`,
  };
}
```

---

## After Completion: What Changes

### MBNA UI Manager (`ui/mbna/uiManager.js`)

The `handleUploadClick` function changes from:
```js
import { uploadMbnaAccount } from '../../services/mbna-upload';
// ...
const result = await uploadMbnaAccount(account, api);
```

To:
```js
import { prepareAndSyncAccount } from '../../services/common/syncOrchestrator';
import { manifest, syncHooks } from '../../integrations/mbna';
// ...
const result = await prepareAndSyncAccount({
  integrationId: 'mbna', manifest, hooks: syncHooks, api, account,
  accountDisplayName: account.displayName || `MBNA Card (${account.endingIn})`,
});
```

### Files Deleted
- `src/services/mbna-upload.js` ← **eliminated**
- `test/services/mbna-upload.test.js` ← updated/moved

### Files Created
- `src/services/common/accountMappingResolver.js` (~100 lines)
- `test/services/common/accountMappingResolver.test.js`

### Files Modified
- `src/services/common/syncOrchestrator.js` — add `prepareAndSyncAccount()`
- `src/integrations/mbna/sinks/monarch/syncHooks.js` — add `suggestStartDate`, `buildAccountEntry`
- `src/integrations/mbna/manifest.js` — add `accountCreateDefaults`
- `src/integrations/types.js` — add new hook typedefs
- `src/ui/mbna/uiManager.js` — import from orchestrator instead of upload service
- `test/services/common/syncOrchestrator.test.js` — add tests for `prepareAndSyncAccount`
- `test/integrations/mbna/syncHooks.test.js` — add tests for new hooks

---

## Scope: MBNA Only (This Phase)

This plan focuses on eliminating **only `mbna-upload.js`** as the proof-of-concept. The generic components built here (`accountMappingResolver.js`, `prepareAndSyncAccount`) are designed to work for Rogers Bank next, but Rogers Bank has significant additional complexity:

- Inline `fetch()` API calls (not yet extracted to integration module)
- Balance reconstruction logic (Rogers-specific, not yet in a hook)
- Category resolution (different from MBNA's approach)
- Account validation against Monarch (checking deleted accounts)

Those are future work. **This phase keeps the blast radius small:** ~100 new lines + ~80 orchestrator additions + 2 small hooks, eliminates 238 lines.

---

## Implementation Steps

1. Add `accountCreateDefaults` to MBNA manifest
2. Add `suggestStartDate` and `buildAccountEntry` hooks to MBNA syncHooks
3. Update `types.js` with new hook typedefs
4. Create `accountMappingResolver.js` with `resolveAccountMapping()`
5. Add `prepareAndSyncAccount()` to `syncOrchestrator.js`
6. Update MBNA UI manager to call `prepareAndSyncAccount()` directly
7. Delete `mbna-upload.js`
8. Update/move tests
9. Run full build validation
10. Bump version, commit