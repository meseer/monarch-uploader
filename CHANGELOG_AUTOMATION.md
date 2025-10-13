# Changelog Automation Implementation

## Overview

Automatic changelog generation has been implemented for both CI and Release workflows. The Gist description will now automatically include recent changes whenever it's updated.

## Changes Made

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Trigger:** Every commit to `main` branch

**Changes:**
- Extracts the current commit message
- Includes it in the Gist description

**Result Format:**
```
Monarch Money Balance Uploader v3.26.5-dev (commit abc1234) - Tampermonkey userscript | Latest: Synchronize orders (but not deposits and withdrawals)
```

### 2. Release Workflow (`.github/workflows/release.yml`)

**Trigger:** When a version tag is pushed (e.g., `v3.26.6`)

**Changes:**
- Generates a condensed changelog from all commits since the last tag
- Limits to the last 10 commits to avoid exceeding API limits
- Includes it in the Gist description

**Result Format:**
```
Monarch Money Balance Uploader v3.26.5 - Tampermonkey userscript | Changes: Synchronize orders | Additional test coverage | Synchronize positions | Add holding management APIs
```

## How It Works

### CI Workflow (Per-Commit)

```bash
# Extract current commit message
COMMIT_MSG=$(git log -1 --pretty=format:"%s")

# Include in Gist description
"description": "Monarch Money Balance Uploader v${VERSION}-dev (commit ${COMMIT_SHA}) - Tampermonkey userscript | Latest: ${COMMIT_MSG}"
```

### Release Workflow (Per-Tag)

```bash
# Generate condensed changelog (last 10 commits)
PREVIOUS_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
if [ -n "$PREVIOUS_TAG" ]; then
  CONDENSED_CHANGELOG=$(git log --pretty=format:"%s" $PREVIOUS_TAG..HEAD | head -n 10 | paste -sd " | " -)
else
  CONDENSED_CHANGELOG=$(git log -1 --pretty=format:"%s")
fi

# Include in Gist description
"description": "Monarch Money Balance Uploader v${VERSION} - Tampermonkey userscript | Changes: ${CONDENSED_CHANGELOG}"
```

## Benefits

1. **Automatic Updates** - No manual changelog writing needed
2. **Always Current** - Gist description reflects latest changes
3. **Two Formats**:
   - **Development builds**: Single commit message
   - **Stable releases**: All commits since last release
4. **Git-based** - Uses actual commit history
5. **User-Friendly** - Clear, concise format

## Testing

To test the implementation:

### Test CI Workflow (Development Build)
1. Make a commit to `main` branch
2. Push to GitHub
3. Check Gist description at: https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7
4. Verify it includes the commit message

### Test Release Workflow (Stable Build)
1. Create a version tag: `git tag v3.26.6`
2. Push tag: `git push origin v3.26.6`
3. Wait for GitHub Actions to complete
4. Check Gist description
5. Verify it includes condensed changelog

## Example Output

### Development Build (CI)
```
Monarch Money Balance Uploader v3.26.5-dev (commit 395637b) - Tampermonkey userscript | Latest: Synchronize orders (but not deposits and withdrawals)
```

### Stable Release
```
Monarch Money Balance Uploader v3.26.6 - Tampermonkey userscript | Changes: Fix transaction sync bug | Improve error handling | Update documentation | Add new test cases
```

## Maintenance

The changelog generation is fully automated and requires no maintenance. However:

- **Commit messages should be descriptive** - They will appear in the changelog
- **Limit to 10 commits** in release changelog - Prevents API size limits
- **Follows conventional commits** - Consider using conventional commit format for better changelog readability

## Files Modified

1. `.github/workflows/ci.yml` - Added commit message extraction and inclusion in Gist description
2. `.github/workflows/release.yml` - Added condensed changelog generation and inclusion in Gist description
