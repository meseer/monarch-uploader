# Version Management Guidelines

## For AI Assistants (Cline) - ALWAYS READ THIS

### 🚨 MANDATORY: Update Version After Every Change

**Critical Locations to Update (BOTH files must match):**
- `package.json` (line 3: `"version": "X.Y.Z"`)
- `src/userscript-metadata.js` (line 4: `// @version X.Y.Z`)

### Version Increment Decision Tree

**Ask yourself: What type of changes did I make?**

#### Patch Version (0.0.X) - Increment by 0.0.1
**Small changes, bug fixes, refactoring:**
- ✅ Bug fixes in existing functionality
- ✅ Code refactoring without API changes
- ✅ Documentation updates
- ✅ Minor UI tweaks (styling, text changes)
- ✅ Single file modifications
- ✅ Performance improvements
- ✅ Test updates
- ✅ Linting/formatting changes

#### Minor Version (0.X.0) - Increment by 0.1.0 (reset patch to 0)
**New features, enhancements:**
- ✅ New UI components or pages
- ✅ New functionality within existing services
- ✅ Multiple file changes for feature addition
- ✅ New configuration options
- ✅ Enhanced existing features
- ✅ New utility functions
- ✅ Added new storage keys
- ✅ New API endpoints integration

#### Major Version (X.0.0) - Increment by 1.0.0 (reset minor and patch to 0)
**Breaking changes, major additions:**
- ✅ New financial institution support (new @match domains)
- ✅ Major API changes that break compatibility
- ✅ Significant architectural changes
- ✅ New @grant permissions in userscript
- ✅ Breaking configuration changes
- ✅ Major UI overhauls
- ✅ New core services or modules

### Quick Reference Examples

| Change Description | Version Type | Example |
|-------------------|--------------|---------|
| Fixed a typo in error message | Patch | 3.8.0 → 3.8.1 |
| Added new upload button to existing page | Minor | 3.8.1 → 3.9.0 |
| Added support for new bank (TD Bank) | Major | 3.9.0 → 4.0.0 |
| Refactored state management code | Patch | 4.0.0 → 4.0.1 |
| Added settings modal | Minor | 4.0.1 → 4.1.0 |

### Step-by-Step Process

1. **Complete your changes**
2. **Assess complexity** using guidelines above
3. **Update both files** with new version number
4. **Verify versions match** between package.json and userscript-metadata.js
5. **Test build process** if making significant changes

### Version Synchronization Check

Before finalizing, ensure these match:
```bash
# These should be identical:
grep '"version"' package.json
grep '@version' src/userscript-metadata.js
```

## For Human Developers

### Semantic Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR.MINOR.PATCH** (e.g., 3.8.0)
- **Major**: Breaking changes or new institution support
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes, backward compatible

### Manual Version Updates

When updating versions manually:

1. **Update package.json:**
   ```json
   {
     "version": "3.9.0"
   }
   ```

2. **Update userscript-metadata.js:**
   ```javascript
   // @version      3.9.0
   ```

3. **Run build to verify:**
   ```bash
   npm run build
   ```

### Git Commit Messages

Include version in commit messages:
```
feat: add Rogers Bank support (v4.0.0)
fix: resolve upload date formatting issue (v3.8.1)
docs: update installation instructions (v3.8.2)
```

### Release Process

1. Update versions in both files
2. Update CHANGELOG.md (if exists)
3. Build and test
4. Commit with descriptive message
5. Tag release: `git tag v3.9.0`

## Current Version Status

**Current Package Version:** Check `package.json`
**Current Userscript Version:** Check `src/userscript-metadata.js`

⚠️ **If versions don't match, synchronize them before making changes!**

## Troubleshooting

**Q: Versions are out of sync?**
A: Update both files to the higher version number, then proceed.

**Q: Not sure which version type to use?**
A: When in doubt, use patch. It's safer to under-increment than over-increment.

**Q: Made multiple types of changes?**
A: Use the highest impact change type. If you fixed bugs AND added features, use minor version.

---

*This file helps maintain consistent versioning across the project. Both AI assistants and human developers should follow these guidelines.*
