# Supplier Signal

Triage for Soulspiti's producer messages. See [PROJECT.md](PROJECT.md) for the problem and scope.

Next.js 15 App Router, TypeScript, one global stylesheet, no database. All data lives in the
in-memory store in `lib/store.ts` and resets on restart; pages only call its async functions.

```bash
npm install
npm run dev
```

- `/` open orders with producer tier and days until promised dispatch
- `/producers` tier signals and declared weekly capacity against committed units
