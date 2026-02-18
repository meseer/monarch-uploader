# Versioning Guidelines - MANDATORY

## How to Update the Version

**Run the version bump script** — it updates all required locations automatically:

```bash
npm run version:bump -- X.Y.Z
```

This single command updates:
- `package.json` → `"version": "X.Y.Z"`
- `src/scriptInfo.json` → `"version": "X.Y.Z"`
- `README.md` → version badge

**Do NOT manually edit version strings in these files.** Always use the script.

The `src/userscript-metadata.cjs` reads version from `scriptInfo.json` at build time — do NOT edit it directly for version changes.

## Version Increment Rules

- **Patch** (X.Y.Z+1): Bug fixes, refactoring, docs, minor UI tweaks, test updates
- **Minor** (X.Y+1.0): New features, new UI components, new config options, new storage keys, new API integrations
- **Major** (X+1.0.0): New financial institution support, breaking API changes, new @grant permissions, major architectural changes

When in doubt, use patch. If multiple change types, use the highest impact.

## How to Determine the Current Version

```bash
node -p "require('./src/scriptInfo.json').version"
```

See `VERSIONING.md` for full details and examples.