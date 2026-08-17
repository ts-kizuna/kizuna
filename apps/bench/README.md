# bench

Measures what ts-kizuna costs on top of each HTTP adapter. Every adapter runs twice with the same three routes: once written directly against the framework, once through a ts-kizuna contract. The difference between the two runs is the price of the contract pipeline (routing, validation, serialization).

Three routes, chosen to stress different parts of that pipeline:

- `getUser`: path param in, small object out.
- `listUsers`: query parsing in, a 25-item list out.
- `createUser`: validated JSON body in, created object out.

Three measurements per server:

- **Throughput**: sustained requests per second under load (autocannon).
- **Latency**: p50 and p99 per request. Throughput hides tail cost, p99 shows what the slowest requests pay.
- **Startup**: time from process spawn to the first successful response, median over several fresh spawns.

## Running

```sh
pnpm bench            # all adapters
pnpm bench express    # one adapter (express, fastify, hono)
```

Tune with environment variables: `BENCH_DURATION` (seconds per measured run, default 10), `BENCH_WARMUP` (seconds of warmup per scenario, default 2), `BENCH_CONNECTIONS` (concurrent connections, default 50), `BENCH_STARTUP_RUNS` (fresh spawns for the startup median, default 5).

Raw numbers land in `results/` as JSON, one file per run.

## Reading the numbers

Both variants run under `tsx`, so the startup column overstates a production start equally on both sides. Compare the pair, not the absolute value. The baseline servers validate nothing, so part of the throughput gap is validation work the plain server simply is not doing.
