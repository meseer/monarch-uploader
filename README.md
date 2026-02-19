# Monarch Uploader

<!-- Badge section -->
[![CI](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml/badge.svg)](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/meseer/monarch-uploader/branch/main/graph/badge.svg)](https://codecov.io/gh/meseer/monarch-uploader)
[![Version](https://img.shields.io/badge/version-5.94.1-blue)](https://github.com/meseer/monarch-uploader)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

A [Violentmonkey](https://violentmonkey.github.io/) userscript that automatically syncs balance history, transactions, holdings, and more from Canadian financial institutions to [Monarch Money](https://www.monarchmoney.com/).

## Supported Institutions

- **Questrade** — Investment accounts (TFSA, RRSP, margin, etc.)
- **Wealthsimple** — Investment, Cash, and Credit Card accounts
- **Canada Life** — Group retirement and pension plans
- **Rogers Bank** — Credit cards

| Institution | Balance History | Transactions | Holdings | Credit Limit | Category Mappings |
|---|:---:|:---:|:---:|:---:|:---:|
| Questrade | ✅ | ✅ | ✅ | ❌ | ❌ |
| Wealthsimple | ✅ | ✅ | ✅ | ✅ | ✅ |
| Canada Life | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rogers Bank | ✅ | ✅ | ❌ | ✅ | ✅ |

## Installation

### Prerequisites

Install the [Violentmonkey](https://violentmonkey.github.io/) browser extension for your browser:
- [Chrome / Edge / Brave](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
- [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/)

### Install the Userscript

Click the link below to install the script directly in Violentmonkey:

🔗 **[Install Monarch Uploader](https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js)**

Violentmonkey will open an installation prompt — click **Confirm installation**. The script will auto-update whenever a new version is published.

### Usage

1. Log in to [Monarch Money](https://app.monarch.com/) in your browser so the session is active.
2. Navigate to any of the supported institution websites (Questrade, Wealthsimple, Canada Life, or Rogers Bank).
3. The script will inject an **Upload to Monarch** button into the page.
4. Click the button to sync your data. Use the ⚙️ settings gear to configure account mappings, sync preferences, and category mappings.

## Development

### Prerequisites

- Node.js (v14+)
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
2. Open the Violentmonkey dashboard in your browser.
3. Click the **+** button and select **Install from file** (or create a new script and paste the contents).
4. Select `dist/questrade-account-balance-uploader.user.js` from the build output.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License — see the [LICENSE](LICENSE) file for details.

[![License: CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/80x15.png)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

- ✅ **Attribution** — You must give appropriate credit when using this code
- ✅ **NonCommercial** — You may not use this code for commercial purposes
- ✅ **ShareAlike** — If you modify this code, you must distribute your contributions under the same license
- ✅ **Free for personal and open-source projects** — Perfect for learning, contributing, or building non-commercial tools