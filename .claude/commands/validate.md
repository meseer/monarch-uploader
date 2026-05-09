Run the full build validation sequence. All steps must pass with zero errors:

```bash
npm run lint && npm test && npm run build && npm run build:full
```

If any step fails, report what failed and suggest a fix.