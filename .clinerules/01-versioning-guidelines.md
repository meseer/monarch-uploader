# Versioning Guidelines - MANDATORY

## Version Locations (ALL must match)

Update version in **ALL THREE** locations after any changes:
1. `package.json` → `"version": "X.Y.Z"`
2. `src/scriptInfo.json` → `"version": "X.Y.Z"`
3. `README.md` → version badge `[![Version](https://img.shields.io/badge/version-X.Y.Z-blue)]`

The `src/userscript-metadata.cjs` reads version from `scriptInfo.json` at build time — do NOT edit it directly for version changes.

## Version Increment Rules

- **Patch** (X.Y.Z+1): Bug fixes, refactoring, docs, minor UI tweaks, test updates
- **Minor** (X.Y+1.0): New features, new UI components, new config options, new storage keys, new API integrations
- **Major** (X+1.0.0): New financial institution support, breaking API changes, new @grant permissions, major architectural changes

When in doubt, use patch. If multiple change types, use the highest impact.

See `VERSIONING.md` for full details and examples.