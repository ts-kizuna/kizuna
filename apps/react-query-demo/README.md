# react-query demo

A Vite + React SPA using [`@ts-kizuna/react-query`](../../packages/react-query) with TanStack Query.

It talks to the shared contract through the Express demo server. Run that first, then this app:

```sh
# terminal 1 — API on :8000
pnpm --filter @ts-kizuna-demo/express server

# terminal 2 — Vite dev server (proxies /api → :8000)
pnpm --filter @ts-kizuna-demo/react-query dev
```
