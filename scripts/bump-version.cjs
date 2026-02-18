#!/usr/bin/env node

/**
 * Version bump script — updates version in all required locations:
 * - package.json
 * - src/scriptInfo.json
 * - README.md (badge)
 *
 * Usage: node scripts/bump-version.cjs <new-version>
 * Example: node scripts/bump-version.cjs 5.86.0
 */

const fs = require('fs');
const path = require('path');

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

const ROOT = path.resolve(__dirname, '..');

const FILES = {
  packageJson: path.join(ROOT, 'package.json'),
  scriptInfo: path.join(ROOT, 'src', 'scriptInfo.json'),
  readme: path.join(ROOT, 'README.md'),
};

function main() {
  const newVersion = process.argv[2];

  if (!newVersion) {
    console.error('Usage: node scripts/bump-version.cjs <new-version>');
    console.error('Example: node scripts/bump-version.cjs 5.86.0');
    process.exit(1);
  }

  if (!SEMVER_REGEX.test(newVersion)) {
    console.error(`Invalid version format: "${newVersion}". Expected format: X.Y.Z (e.g., 5.86.0)`);
    process.exit(1);
  }

  // 1. Update package.json
  const packageJson = JSON.parse(fs.readFileSync(FILES.packageJson, 'utf8'));
  const oldVersion = packageJson.version;

  if (oldVersion === newVersion) {
    console.log(`Version is already ${newVersion}. Nothing to do.`);
    process.exit(0);
  }

  packageJson.version = newVersion;
  fs.writeFileSync(FILES.packageJson, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
  console.log(`✅ package.json: ${oldVersion} → ${newVersion}`);

  // 2. Update src/scriptInfo.json
  const scriptInfo = JSON.parse(fs.readFileSync(FILES.scriptInfo, 'utf8'));
  scriptInfo.version = newVersion;
  fs.writeFileSync(FILES.scriptInfo, JSON.stringify(scriptInfo, null, 2) + '\n', 'utf8');
  console.log(`✅ src/scriptInfo.json: ${oldVersion} → ${newVersion}`);

  // 3. Update README.md badge
  const readme = fs.readFileSync(FILES.readme, 'utf8');
  const badgePattern = /version-\d+\.\d+\.\d+-blue/g;
  const matches = readme.match(badgePattern);

  if (!matches) {
    console.error('❌ README.md: Could not find version badge (expected pattern: version-X.Y.Z-blue)');
    process.exit(1);
  }

  const updatedReadme = readme.replace(badgePattern, `version-${newVersion}-blue`);
  fs.writeFileSync(FILES.readme, updatedReadme, 'utf8');
  console.log(`✅ README.md: badge updated to ${newVersion}`);

  console.log(`\nVersion bumped: ${oldVersion} → ${newVersion}`);
}

main();