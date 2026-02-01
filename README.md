# Monarch Money Balance Uploader

<!-- Badge section -->
[![CI](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml/badge.svg)](https://github.com/meseer/monarch-uploader/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/meseer/monarch-uploader/branch/main/graph/badge.svg)](https://codecov.io/gh/meseer/monarch-uploader)
[![Version](https://img.shields.io/badge/version-5.58.3-blue)](https://github.com/meseer/monarch-uploader)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

A Tampermonkey userscript for uploading balance history from Questrade and Canada Life to Monarch Money.

## Features

- Download balance history from Questrade accounts
- Upload balance history to Monarch Money
- Support for individual account or bulk account processing
- Progress tracking for multi-account operations
- Date range selection
- Toast notifications for operation feedback

## Project Structure

+```
monarch-uploader/
├── src/                    # Source code
│   ├── index.js            # Entry point
│   ├── core/               # Core modules
│   │   ├── config.js       # Configuration
│   │   ├── state.js        # State management
│   │   └── utils.js        # Utility functions
│   ├── api/                # API clients
│   │   ├── questrade.js    # Questrade API client
│   │   └── monarch.js      # Monarch Money API client
│   ├── ui/                 # UI components
│   │   ├── components/     # Reusable components
│   │   ├── modals/         # Modal dialogs
│   │   └── toast.js        # Toast notifications
│   └── services/           # Business logic services
│       ├── auth.js         # Authentication service
│       ├── account.js      # Account management
│       └── balance.js      # Balance history service
├── dist/                   # Build output
├── test/                   # Test files
└── ...                     # Configuration files
```

## Development Setup

### Prerequisites

- Node.js (v14+)
- npm or yarn

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/monarch-uploader.git
   cd monarch-uploader
   ```

2. Install dependencies
   ```
   npm install
   ```

### Development Commands

- Build for development:
  ```
  npm run build:dev
  ```

- Build for production:
  ```
  npm run build
  ```

- Watch for changes:
  ```
  npm run watch
  ```

- Run tests:
  ```
  npm test
  ```

- Lint code:
  ```
  npm run lint
  ```

- Fix linting issues:
  ```
  npm run lint:fix
  ```

### Installing the Userscript

There are two ways to install the userscript:

#### Option 1: Direct Installation (Recommended)

**Latest Development Version** (updated with every push to main):
- 🔗 **[Install Development Version](https://github.com/meseer/monarch-uploader/releases/download/dev-latest/monarch-uploader-dev.user.js)**
- URL: `https://github.com/meseer/monarch-uploader/releases/download/dev-latest/monarch-uploader-dev.user.js`

**Stable Release Version** (updated with each official release):
- 🔗 **[Install Stable Version](https://github.com/meseer/monarch-uploader/releases/latest/download/monarch-uploader-stable.user.js)**
- URL: `https://github.com/meseer/monarch-uploader/releases/latest/download/monarch-uploader-stable.user.js`

#### Option 2: Manual Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Build the project locally with `npm run build`
3. Open Tampermonkey dashboard
4. Create a new script or import from file
5. Copy-paste the content from `dist/questrade-account-balance-uploader.user.js`
6. Save the script

#### Installation Notes

- **Development Version**: Gets the latest features and fixes immediately, but may be less stable
- **Stable Version**: Thoroughly tested releases, recommended for production use
- Both URLs support auto-updates in Tampermonkey - the extension will automatically check for and install updates

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License - see the [LICENSE](LICENSE) file for details.

[![License: CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/80x15.png)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

**What this means:**
- ✅ **Attribution**: You must give appropriate credit when using this code
- ✅ **NonCommercial**: You may not use this code for commercial purposes
- ✅ **ShareAlike**: If you modify this code, you must distribute your contributions under the same license
- ✅ **Free for personal and open-source projects**: Perfect for learning, contributing, or building non-commercial tools

This license prevents commercial use while encouraging collaboration in the open-source community.
