# Version Management Guidelines

## Version Locations (ALL must match)

**Update version in ALL THREE locations after any changes:**
1. `package.json` → `"version": "X.Y.Z"`
2. `src/scriptInfo.json` → `"version": "X.Y.Z"`
3. `README.md` → version badge `[![Version](https://img.shields.io/badge/version-X.Y.Z-blue)]`

The `src/userscript-metadata.cjs` reads version from `scriptInfo.json` at build time — do NOT edit it directly for version changes.

## Version Increment Decision Tree

**Ask yourself: What type of changes did I make?**

### Patch Version (0.0.X) — Increment by 0.0.1
**Small changes, bug fixes, refactoring:**
- Bug fixes in existing functionality
- Code refactoring without API changes
- Documentation updates
- Minor UI tweaks (styling, text changes)
- Performance improvements, test updates, linting/formatting changes

### Minor Version (0.X.0) — Increment by 0.1.0 (reset patch to 0)
**New features, enhancements:**
- New UI components or pages
- New functionality within existing services
- New configuration options
- Enhanced existing features, new utility functions
- New storage keys, new API endpoints integration

### Major Version (X.0.0) — Increment by 1.0.0 (reset minor and patch to 0)
**Breaking changes, major additions:**
- New financial institution support (new @match domains)
- Major API changes that break compatibility
- Significant architectural changes
- New @grant permissions in userscript
- Breaking configuration changes, major UI overhauls

## Quick Reference Examples

| Change Description | Version Type | Example |
|-------------------|--------------|---------|
| Fixed a typo in error message | Patch | 3.8.0 → 3.8.1 |
| Added new upload button to existing page | Minor | 3.8.1 → 3.9.0 |
| Added support for new bank (TD Bank) | Major | 3.9.0 → 4.0.0 |
| Refactored state management code | Patch | 4.0.0 → 4.0.1 |
| Added settings modal | Minor | 4.0.1 → 4.1.0 |

## Version Synchronization Check

Before finalizing, ensure these match:
```bash
grep '"version"' package.json
grep '"version"' src/scriptInfo.json
grep 'version-' README.md
```

## Semantic Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR.MINOR.PATCH** (e.g., 3.8.0)
- **Major**: Breaking changes or new institution support
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes, backward compatible

When in doubt, use patch. If multiple change types, use the highest impact.