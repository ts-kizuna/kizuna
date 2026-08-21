# Philosophy

ts-kizuna is an HTTP and OpenAPI spec-driven library. It follows the relevant RFCs and OpenAPI best practices strictly, not for convenience, not for ergonomics. When in doubt, follow the spec.

## Specs

- **RFC 9110** (HTTP Semantics, June 2022): methods, status codes, headers, content negotiation
- **RFC 5789** (PATCH Method, April 2010): PATCH semantics
- **RFC 9457** (Problem Details for HTTP APIs, July 2023): error response bodies
- **RFC 3986** (URI Syntax, January 2005): paths match exactly, so `/users/1` and `/users/1/` differ
- **OpenAPI 3.1.0**: spec generation
- **OAuth 2.1**: the resource server model, for an API that verifies tokens rather than issuing them
- **RFC 9728** (OAuth 2.0 Protected Resource Metadata, April 2025): the discovery document
- **RFC 8414** (OAuth 2.0 Authorization Server Metadata, June 2018): an identity's `issuer`
- **RFC 8707** (Resource Indicators for OAuth 2.0, February 2020): the canonical `resource` URI and the audience a guard checks
- **RFC 6750** (OAuth 2.0 Bearer Token Usage, October 2012): the `WWW-Authenticate` challenge, including `insufficient_scope`
- **Model Context Protocol**: the MCP endpoint, its tools, their names, and its authorization

### MCP tool names

`users.getUser` publishes as `users_get_user`. The [spec](https://modelcontextprotocol.io/specification/latest/server/tools) allows the dot, but Claude Code rewrites it to `_` before the model sees the name, so publishing the dot means the tool is called something kizuna never chose.

### Deliberate omissions

- **TRACE**: excluded from `Method`. Universally disabled in production and unsupported by modern frameworks. Do not add it.
- **Auto HEAD-via-GET fallback**: ts-kizuna is contract-first; if HEAD isn't in the contract it doesn't exist. HEAD on a GET-only route returns 405. Authors who want HEAD declare an explicit HEAD route. Express handles HEAD natively for GET routes as a framework feature; Next and other adapters return 405. Might reconsider at a later time.

# Jobs

Jobs (`k.jobs`) are the one non-HTTP-shaped concept. Settled; don't relitigate.

- A job is a sibling of a route, never inside one. Nothing that walks `contract.routes` sees a job.
- A handler receives only `input` and `throwError`. Anything more it imports, as a route handler would.
- A job declares no path and no method. `schedule` is optional.
- Two endpoints serve every job, both under the `jobs.path` namespace (default `/jobs`, which serves nothing itself): `POST /jobs/dispatch` runs whatever is due, `POST /jobs/run` runs the one job its `{ job, input }` body names. A job is addressed by its dotted key.
- `run` and `queue`, never a bare call. `run` takes the input; `queue` takes a message (`input`, `runAt`, `dedupeKey`).

Deliberate omissions: no first-party transports, no stored state, and no per-job cron generation. Retries, deduplication, and run history belong to the transport. An occurrence's dedupe key is `job@occurrenceISO`.

# Naming

Use full English words.

- No single-letter names (`u`, `x`, `s`, `r`, `v`, `i`). Use `user`, `candidate`, `server`, `result`, `value`, `index`.
- No truncated abbreviations (`idx`, `cfg`, `usr`). Spell it out.
- Name callback parameters after what they represent: `users.find((candidate) => ...)`.

Exceptions: `_` for unused, `req`/`res`/`next` in Express handlers, `_`-prefixed unused params, and namespace tokens (`k`, `z`).

# Object literals

Always multi-line. Every property on its own line, every nested object expanded, even single-property ones.

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

Always multi-line. `/**` on its own line, content on its own line(s), `*/` on its own line, even for one-liners.

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

# Writing

Applies equally to docs pages, README, JSDoc, and code comments.

- **Plain over clever.** If a sentence has to be decoded, it is wrong. A reader should never have to supply the meaning of your metaphor.
- **Say the concrete thing.** "Swift and Kotlin clients" rather than "native clients". Name what the reader gets, not the category it belongs to.
- **Prefer commas and full stops over em dashes.** An em dash rarely earns the interruption it creates. Where a sentence needs a break, use a comma or start a new sentence, not a semicolon.
- **One idea per example.** A snippet that demonstrates two things teaches neither. Split it.
- **Stop when it is said.** No filler ("simply", "seamlessly", "powerful", "just"), no restating the previous sentence, no explaining what the reader already worked out.
- **Never define a thing by what it is not.** "It is not a wrapper, it is a contract", "an alternative rather than a rewrite", "this is not about performance". Naming the thing you did not mean forces the reader to hold two ideas to arrive at one. Say the thing.

# Comments

Examples in comments and JSDoc use names from this repo's own contract (`UserSchema`, `createUser`, `listEvents`, etc.), not from consumer projects.

# Adapters

First-party adapters (in `packages/`) always ship with:

- **Demo app**: a working example app in `apps/` (e.g. `apps/express-demo`, `apps/hono-demo`)
- **Documentation**: an adapter page in `docs/content/docs/adapters/`, plus updates to every doc page that lists adapters
- **Shared suites**: a `testAdapterFeatures(...)` call in its `*.test.ts` and a `checkAdapterTypeFeatures(...)` call in its `*.test-d.ts`, both from `packages/core/src/adapter-testing/`. Both catalogues are exhaustive, so adding a feature to either one breaks every adapter until each answers it. Legitimate framework differences belong in `ADAPTER_BEHAVIOUR` or in a plain `test()` beside the catalogue call, never silently dropped.

# Plugins

A plugin ships in two halves, and which half a module belongs to decides what it may import:

- **Declaration**: the package's main entry, built with `createPlugin` from `@ts-kizuna/core/plugin`. Installed under `plugins` on `k.contract`, where props that name routes are checked against them: write `plugins` as a function and its `routes` are handed over. It rides on the contract, and a contract is shared with browser bundles, so it may import only what a browser bundles. Use `import type` for anything the server half owns; types are erased, values are not.
- **Server**: the `./server` subpath, built with `implementPlugin` from `@ts-kizuna/core/adapter`. Only the server app imports it, so it may import anything, including Node built-ins and Node-only dependencies.

Every export subpath of every package under `packages/` declares its reach under `kizuna.entries` in its own `package.json`. `tests/client-safe.test.ts` enforces the boundary rather than documenting it: it bundles each `client` entry for a browser target and fails on any Node built-in, derives reach from the demo contract's own import graph so a mislabelled entry is caught, and requires every plugin to be installed on `apps/shared/src/contract.ts`. It reads `dist`, so run `pnpm build` before it.

Nothing else needs to know a plugin exists: its routes never join `contract.routes`, so the client and the generators do not see them.

# Publishing

Every package under `packages/` publishes to npmjs as `@ts-kizuna/*`. The release workflow authenticates with GitHub's OIDC token, not a stored secret: each package has a trusted publisher on npm naming this repository and `release.yaml`. There is no `NPM_TOKEN`, and nothing needs one.

`private: true` is what keeps a workspace package unpublished, which is why nothing in `apps/` or `docs` reaches the registry.

## Adding a package

A package needs everything the published thirteen carry, or its npm page is the poorer for it. Copy an existing sibling's `package.json` and keep every field: `description`, `keywords` (the shared base plus a few specific), `license`, `homepage` pointing at that package's own docs page, `repository` with its `directory`, `bugs`, `sideEffects`, `engines`, and `publishConfig.access` set to `public`. A scoped package publishes **restricted** without that last one.

Also add a `README.md`, because npm renders the package's own file and nothing else. Four parts: the description, an install line, the smallest snippet that works, and a link to its docs page. Take the snippet from the docs rather than writing a fresh one. Add the package to the table in the root `README.md` too, which is where its `description` comes from.

## The first publish of a new package

npm cannot configure a trusted publisher for a package that does not exist yet, and the release workflow holds no token to fall back on. So a new package cannot publish itself, and the bootstrap is manual:

1. Ship it with `private: true` so `pnpm -r publish` skips it and a release cannot half-fail on it.
2. Let a release go out first. `pnpm publish` rewrites `workspace:*` to the exact version it finds, so the package pins its peers to sibling versions that have to be on npm already. A new package often needs exports added to a sibling in the same PR, and those reach the registry with that release.
3. Publish it once by hand, from a clean checkout of the release tag, with the `private: true` line deleted in the working tree. pnpm and npm both refuse to publish a package marked private, and pnpm says so as `There are no new packages that should be published`. A tag checkout leaves HEAD detached, which pnpm's branch check rejects, so pass `--no-git-checks`:

    ```
    pnpm --filter @ts-kizuna/<name> build
    pnpm --filter @ts-kizuna/<name> publish --access public --no-git-checks
    ```

    Answer the 2FA prompt. This has to be interactive, as the registry asks for a one-time password.

4. Add the trusted publisher at `https://www.npmjs.com/package/@ts-kizuna/<name>/access`: GitHub Actions, `ts-kizuna`, `kizuna`, workflow `release.yaml`, no environment, both `publish` and `stage publish` allowed.
5. Commit the removal of `private: true`, once the trusted publisher is in place. A release that runs with the flag off and no trusted publisher fails on the package.

Every release after that publishes it with the rest, and the one hand-published version is the only one without a provenance attestation.

When changing any exported function, type, or option in `packages/*/src/`, check if README.md, JSDoc examples, guide pages in `docs/content/docs/`, or API reference pages in `docs/content/docs/reference/` reference the old API. If so, update them in the same change. When in doubt, grep the `docs/` directory for the function or type name.

# Running tests

- `pnpm test` runs Vitest + Swift end-to-end. Always use this.
- `pnpm test:types` runs type-level tests only (`*.test-d.ts`).
- `pnpm -r typecheck` runs `tsc --noEmit` across all packages. Always pair with `pnpm test` before declaring something done.
- `pnpm build` rebuilds all packages. Required before typechecking after changing cross-package exports.
- `pnpm --filter @ts-kizuna-demo/kotlin test` runs Kotlin end-to-end (starts express-demo, compiles the generated client, runs `./gradlew test`). Not part of `pnpm test`.

## Compiling the Kotlin demo

The Kotlin demo (`apps/kotlin-demo/kotlin`) verifies that generated `@ts-kizuna/kotlin` output actually compiles. Its Gradle (8.10.2, `jvmToolchain(17)`) **rejects JDK 26** with a cryptic `What went wrong: 26.0.1` error, so run it with JDK 17:

```
JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ./gradlew compileKotlin
```

`openjdk@17` is available via Homebrew (`brew install openjdk@17`). The same `JAVA_HOME` is needed for the `test` script above.

# Formatting

After finishing code edits, always run `pnpm format:check` to verify formatting. If it fails, run `pnpm format` to fix it.
