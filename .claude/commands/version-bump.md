Bump the project version to $ARGUMENTS.

Run:
```bash
npm run version:bump -- $ARGUMENTS
```

Then verify the version was updated in all locations:
```bash
node -p "require('./src/scriptInfo.json').version"
grep -o 'version-[0-9.]*-blue' README.md
node -p "require('./package.json').version"
```

All three should show the new version.