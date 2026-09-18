Run the full build validation sequence:

```bash
npm run build:full
```

This is clean → lint → typecheck → test → production webpack build. All steps must
pass with zero errors. Fix warnings even when the build succeeds — the only
expected warnings are webpack's bundle-size notices.

If any step fails, report exactly what failed with the relevant output, fix the
root cause, and re-run. For targeted debugging the individual steps are
`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
