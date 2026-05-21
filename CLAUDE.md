# Philosophy

ts-kizuna is an HTTP and OpenAPI spec-driven library. It follows the relevant RFCs and OpenAPI best practices strictly — not for convenience, not for ergonomics. When in doubt, follow the spec.

## Specs

- **RFC 9110** (HTTP Semantics, June 2022) — methods, status codes, headers, content negotiation
- **RFC 5789** (PATCH Method, April 2010) — PATCH semantics
- **OpenAPI 3.1.0** — spec generation

### Deliberate omissions

- **TRACE** — excluded from `Method`. Universally disabled in production and unsupported by modern frameworks. Do not add it.
- **Auto HEAD-via-GET fallback** — ts-kizuna is contract-first; if HEAD isn't in the contract it doesn't exist. HEAD on a GET-only route returns 405. Authors who want HEAD declare an explicit HEAD route. Express handles HEAD natively for GET routes as a framework feature; Next and other adapters return 405. Might reconsider at a later time.

# Naming

Use full English words.

- No single-letter names (`u`, `x`, `s`, `r`, `v`, `k`, `i`). Use `user`, `candidate`, `server`, `result`, `value`, `key`, `index`.
- No truncated abbreviations (`idx`, `cfg`, `usr`). Spell it out.
- Name callback parameters after what they represent: `users.find((candidate) => ...)`.

Exceptions: `_` for unused, `req`/`res`/`next` in Express handlers, `_`-prefixed unused params.

# Object literals

Always multi-line. Every property on its own line, every nested object expanded — even single-property ones.

```ts
// no
client.getUser({ params: { id: '1' } });
client.getUser({
    params: { id: '1' },
});

// yes
client.getUser({
    params: {
        id: '1',
    },
});
```

# JSDoc

Always multi-line. `/**` on its own line, content on its own line(s), `*/` on its own line — even for one-liners.

```ts
// no
/** Return an `AdapterResult` to override the default outcome. */
onError?: (...) => ...;

// yes
/**
 * Return an `AdapterResult` to override the default outcome.
 */
onError?: (...) => ...;
```

# Git

Never add `Co-Authored-By` to commit messages.

# Comments

Examples in comments and JSDoc use names from this repo's own contract (`UserSchema`, `createUser`, `listEvents`, etc.), not from consumer projects.

# Documentation

When changing public API surface (types, function signatures, options), check if README.md or JSDoc examples reference the old API. If so, update them in the same change.

# Running tests

- `pnpm test` — runs Vitest + Swift end-to-end. Always use this.
- `pnpm test:types` — type-level tests only (`*.test-d.ts`).
- `pnpm -r typecheck` — `tsc --noEmit` across all packages. Always pair with `pnpm test` before declaring something done.
- `pnpm build` — rebuild all packages. Required before typechecking after changing cross-package exports.
