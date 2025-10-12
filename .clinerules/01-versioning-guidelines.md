# Versioning Guidelines - MANDATORY

## Critical: Always Update Version Numbers

**You MUST update the version in ALL THREE locations after making any changes:**
1. `package.json` (line 3: `"version": "X.Y.Z"`)
2. `src/userscript-metadata.js` (line 4: `// @version X.Y.Z`)
3. `README.md` version badge (line 6: `[![Version](https://img.shields.io/badge/version-X.Y.Z-blue)]`)

## Version Increment Rules

### Patch Version (X.Y.Z → X.Y.Z+1)
Use for small changes and bug fixes:
- Bug fixes in existing functionality
- Code refactoring without API changes
- Documentation updates
- Minor UI tweaks (styling, text changes)
- Single file modifications
- Performance improvements
- Test updates
- Linting/formatting changes

### Minor Version (X.Y+1.0) - Reset patch to 0
Use for new features and enhancements:
- New UI components or pages
- New functionality within existing services
- Multiple file changes for feature addition
- New configuration options
- Enhanced existing features
- New utility functions
- Added new storage keys
- New API endpoints integration

### Major Version (X+1.0.0) - Reset minor and patch to 0
Use for breaking changes and major additions:
- New financial institution support (new @match domains)
- Major API changes that break compatibility
- Significant architectural changes
- New @grant permissions in userscript
- Breaking configuration changes
- Major UI overhauls
- New core services or modules

## Verification Steps

Before finalizing any changes:
1. Determine the appropriate version increment based on your changes
2. Update `package.json` version
3. Update `src/userscript-metadata.js` version (both instances in the file)
4. Update `README.md` version badge to match the new version
5. Verify all three locations show the same version number
6. Run build to ensure everything compiles correctly

## Important Notes
- **ALWAYS** read and follow the full VERSIONING.md file in the project root
- When in doubt about version type, use patch increment
- If making multiple types of changes, use the highest impact change type
- Versions must be synchronized before proceeding with any other changes
