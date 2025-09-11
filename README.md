# Monarch Money Balance Uploader

A Tampermonkey userscript for uploading balance history from Questrade and EQBank to Monarch Money.

## Features

- Download balance history from Questrade accounts
- Upload balance history to Monarch Money
- Support for individual account or bulk account processing
- Progress tracking for multi-account operations
- Date range selection
- Toast notifications for operation feedback

## Project Structure

```
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

After building, the userscript will be available in the `dist` folder. To install:

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Open Tampermonkey dashboard
3. Create a new script or import from file
4. Copy-paste the content from `dist/questrade-account-balance-uploader.user.js`
5. Save the script

## Refactoring Plan

This project is being refactored following this phased approach:

### Phase 1: Foundation Setup
- Create configuration object
- Set up utility functions wrapper
- Establish basic structure

### Phase 2: Extract UI Components
- Create UI helper objects
- Separate toast and modal components

### Phase 3: Separate API Clients
- Create API wrapper objects for Questrade and Monarch

### Phase 4: State Management
- Implement central state manager
- Migrate from global variables

### Phase 5: Service Layer
- Extract business logic to services
- Add error handling wrappers

### Phase 6: CSS Extraction
- Move inline styles to central style objects

### Phase 7: Module Structure
- Complete modular architecture

### Phase 8-10: Testing, Cleanup, Documentation
- Test all functionality
- Remove duplicate code
- Document new structure

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
