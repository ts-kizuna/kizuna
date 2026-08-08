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

- No single-letter names (`u`, `x`, `s`, `r`, `v`, `i`). Use `user`, `candidate`, `server`, `result`, `value`, `index`.
- No truncated abbreviations (`idx`, `cfg`, `usr`). Spell it out.
- Name callback parameters after what they represent: `users.find((candidate) => ...)`.

Exceptions: `_` for unused, `req`/`res`/`next` in Express handlers, `_`-prefixed unused params, and namespace tokens (`k`, `z`).

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

Never add `Co-Authored-By` trailers for AI agents (Claude, Copilot, Cursor, etc.) to commit messages. AI is a tool, not an author.

# Comments

Examples in comments and JSDoc use names from this repo's own contract (`UserSchema`, `createUser`, `listEvents`, etc.), not from consumer projects.

# Adapters

First-party adapters (in `packages/`) always ship with:

- **MCP integration** — a framework-specific file in `packages/mcp/src/` with its own export in `packages/mcp/package.json`
- **Demo app** — a working example app in `apps/` (e.g. `apps/express-demo`, `apps/hono-demo`)
- **Documentation** — an adapter page in `docs/content/docs/adapters/`, plus updates to every doc page that lists adapters
- **Shared suites**: a `testAdapterFeatures(...)` call in its `*.test.ts` and a `checkAdapterTypeFeatures(...)` call in its `*.test-d.ts`, both from `packages/core/src/adapter-testing/`. Both catalogues are exhaustive, so adding a feature to either one breaks every adapter until each answers it. Legitimate framework differences belong in `ADAPTER_BEHAVIOUR` or in a plain `test()` beside the catalogue call, never silently dropped.

# Documentation

When changing any exported function, type, or option in `packages/*/src/`, check if README.md, JSDoc examples, guide pages in `docs/content/docs/`, or API reference pages in `docs/content/docs/reference/` reference the old API. If so, update them in the same change. When in doubt, grep the `docs/` directory for the function or type name.

# Running tests

- `pnpm test` — runs Vitest + Swift end-to-end. Always use this.
- `pnpm test:types` — type-level tests only (`*.test-d.ts`).
- `pnpm -r typecheck` — `tsc --noEmit` across all packages. Always pair with `pnpm test` before declaring something done.
- `pnpm build` — rebuild all packages. Required before typechecking after changing cross-package exports.
- `pnpm --filter @ts-kizuna-demo/kotlin test` — Kotlin end-to-end (starts express-demo, compiles the generated client, runs `./gradlew test`). Not part of `pnpm test`.

## Compiling the Kotlin demo

The Kotlin demo (`apps/kotlin-demo/kotlin`) verifies that generated `@ts-kizuna/kotlin` output actually compiles. Its Gradle (8.10.2, `jvmToolchain(17)`) **rejects JDK 26** with a cryptic `What went wrong: 26.0.1` error, so run it with JDK 17:

```
JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ./gradlew compileKotlin
```

`openjdk@17` is available via Homebrew (`brew install openjdk@17`). The same `JAVA_HOME` is needed for the `test` script above.

# Formatting

After finishing code edits, always run `pnpm format:check` to verify formatting. If it fails, run `pnpm format` to fix it.
