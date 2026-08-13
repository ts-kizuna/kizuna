# Contributing to ts-kizuna

Thanks for helping out. Here's what we take and how to get set up.

## What we welcome

Bug reports, small reproductions, and documentation fixes are always welcome, as an issue or a PR.

## What we rarely merge

Anything we merge into the core, we maintain, so we keep it to the packages we actually use. Whether an adapter or client goes first-party comes down to adoption, not age: if a framework picks up real usage, we will very likely add it. What we will not take on is a framework a handful of people use. The APIs are public, so you can build exactly what you need and own it today:

- [Adapter](https://ts-kizuna.com/docs/extend/create-adapter)
- [Plugin](https://ts-kizuna.com/docs/extend/create-plugin)
- [Client](https://ts-kizuna.com/docs/extend/create-ts-client)
- [Generator](https://ts-kizuna.com/docs/extend/create-generator)

For anything bigger than a fix or docs, open an issue first. What lands comes down to fit and what we want to maintain, not how polished the PR is.

## Support

ts-kizuna is provided as-is. Most answers are in the docs or the source. For anything else, [open an issue](https://github.com/ts-kizuna/kizuna/issues).

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
