# Contributing to ts-kizuna

Thanks for helping out. Here's what we take and how to get set up.

## What we welcome

Bug reports, small reproductions, and documentation fixes are always welcome, as an issue or a PR.

## What we won't merge

Everything we merge into the core is something we commit to maintaining for the long haul, so we don't take additions lightly. We keep it small and stick to the packages we actually use, which is why new first-party adapters and clients won't be merged. The APIs are public, though, so you can build exactly what you need and own it:

- [Adapter](https://ts-kizuna.com/docs/extend/create-adapter)
- [Client](https://ts-kizuna.com/docs/extend/create-ts-client)
- [Generator](https://ts-kizuna.com/docs/extend/create-generator)

For anything bigger than a fix or docs, open an issue first. What lands comes down to fit and what we want to maintain, not how polished the PR is.

## Support

ts-kizuna is provided as-is. The docs are thorough and the source is open, so most answers are within reach. For anything else, [open an issue](https://github.com/ts-kizuna/kizuna/issues).

## Development

pnpm monorepo:

```bash
pnpm install
pnpm build
```

Before a PR, make sure these pass:

```bash
pnpm test            # Vitest + Swift e2e
pnpm -r typecheck    # tsc --noEmit, all packages
pnpm format:check    # pnpm format to fix
```

## PR titles

We squash-merge, so the PR title becomes the changelog entry and the commit on `main`. Use Conventional Commits:

```
type(scope): summary
```

- **Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`, `style`, `revert`
- **Scope** is required for `feat`, `fix`, `perf`, and `refactor`, and must be a package (`core`, `fetch`, `express`, …). Other types may omit it. (Adding a new package? A maintainer applies the `new scope` label.)
- A check validates this on every PR.

## Commit messages

No `Co-Authored-By` trailers for AI agents. AI is a tool, not an author.
