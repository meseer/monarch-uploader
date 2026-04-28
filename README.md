# Monarch Uploader

<!-- Badge section -->
[![CI](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml/badge.svg)](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/meseer/monarch-uploader/branch/main/graph/badge.svg)](https://codecov.io/gh/meseer/monarch-uploader)
[![Version](https://img.shields.io/badge/version-6.10.1-blue)](https://github.com/meseer/monarch-uploader)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

A userscript that automatically syncs balance history, transactions, holdings, and more from Canadian financial institutions to [Monarch Money](https://www.monarchmoney.com/).

## Quick Demo

<p align="center">
  <img src="docs/assets/demo.gif" alt="Monarch Uploader demo" width="800" />
</p>

> **Note:** This demo shows an earlier version of the script. The current version supports additional institutions and features.

## Supported Institutions

| Institution | Balance History | Transactions | Holdings | Credit Limit | Category Mappings | Multi-Account | Notes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Canada Life | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | Group retirement and pension plans |
| MBNA | ✅ | ✅ | ❌ | ✅ | ✅ | ? | Credit cards |
| Questrade | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | Investment accounts (TFSA, RRSP, margin, etc.) |
| Rogers Bank | ✅ | ✅ | ❌ | ✅ | ✅ | ? | Credit cards |
| Wealthsimple | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Investment, Cash, and Credit Card accounts |

## Installation

### Prerequisites

Install a userscript manager for your browser. Either option works — pick whichever suits your browser:

#### Option A: Violentmonkey (recommended, open-source)

- [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/)
- [Brave / Edge](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)

> ⚠️ **Violentmonkey is not available on Chrome.** It was removed from the Chrome Web Store due to its Manifest V2 architecture, with no Manifest V3 rewrite planned in the foreseeable future. Chrome users should use **Tampermonkey** (see below), or switch to [Brave](https://brave.com/) or [Firefox](https://www.mozilla.org/firefox/).

#### Option B: Tampermonkey (works on all browsers including Chrome)

- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

> ⚠️ **Chrome users:** After installing Tampermonkey, you may need to enable **Developer Mode** for it to function properly:
> 1. Go to `chrome://extensions`
> 2. Toggle **Developer mode** on (top-right corner)
> 3. Restart Chrome if prompted

### Install the Userscript

Click the link below to install the script. Your userscript manager (Violentmonkey or Tampermonkey) will open an installation prompt — click **Confirm installation**.

🔗 **[Install Monarch Uploader](https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js)**

The script will auto-update whenever a new version is published.

### Usage

1. Log in to [Monarch Money](https://app.monarch.com/) in your browser so the session is active.
2. Navigate to any of the supported institution websites (Questrade, Wealthsimple, Canada Life, Rogers Bank, or MBNA).
3. The script will inject an **Upload to Monarch** button into the page.
4. Click the button to sync your data. Use the ⚙️ settings gear to configure account mappings, sync preferences, and category mappings.

### First Use

On the first sync, the script will walk you through a brief setup:

1. **Monarch authentication** — A pop-up will open to retrieve your Monarch session. You may need to log in to Monarch if you don't have an active session.
2. **Starting date** — The script defaults to the account creation date when it can determine it. It is recommended to leave this as is. On subsequent syncs, the script automatically looks back a configurable number of days from your last successful sync (default: 7 days).
3. **Account mapping** — For each institution account, you can choose to: **create a new Monarch account** (recommended), **map to an existing** Monarch account, or **skip** the account sync entirely. This mapping is saved for future syncs.
4. **Category mapping** — For each transaction category, you can map it to a Monarch category as a one-time choice or save it as a reusable rule. Alternatively, you can skip sync-time category mapping entirely and rely on Monarch's built-in categorization rules, which are applied after every sync regardless.
5. **Pending transactions** — The script uploads pending transactions by default and updates them after they settle. To track pending status, the script adds a **"Pending"** tag and a transaction ID to the Monarch transaction's notes. Please keep these details on pending transactions to allow the script to manage them properly — you can add other details to the notes as desired, and they will be retained when the transaction settles (as long as the settled transaction keeps the same date and merchant). Some institutions report the same transaction as both pending and settled for a short period; the script will do its best to deduplicate these, but if transaction details differ (date, description, etc.), you may temporarily see duplicates in Monarch until the institution stops reporting it as pending. Pending transaction sync can be turned off in settings if desired.

## Development

### Prerequisites

- Node.js (v24+)
- npm

### Setup

```bash
git clone https://github.com/meseer/monarch-uploader.git
cd monarch-uploader
npm install
```

### Commands

| Command | Description |
|---|---|
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run watch` | Watch for changes and rebuild |
| `npm test` | Run tests |
| `npm run lint` | Lint code |
| `npm run lint:fix` | Auto-fix linting issues |

### Manual Installation (for development)

1. Build the project: `npm run build`
2. Open Violentmonkey (or Tampermonkey) dashboard in your browser.
3. Click the **+** button and select **Install from file** (or create a new script and paste the contents).
4. Select `dist/monarch-uploader.user.js` from the build output.

## Security

To report a security vulnerability, please see [SECURITY.md](SECURITY.md). **Do not** open a public issue for security concerns.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting pull requests.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License — see the [LICENSE](LICENSE) file for details.

[![License: CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/80x15.png)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

- ✅ **Attribution** — You must give appropriate credit when using this code
- ✅ **NonCommercial** — You may not use this code for commercial purposes
- ✅ **ShareAlike** — If you modify this code, you must distribute your contributions under the same license
- ✅ **Free for personal and open-source projects** — Perfect for learning, contributing, or building non-commercial tools