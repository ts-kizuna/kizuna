export type { KizunaPlugin } from '@ts-kizuna/core/adapter';

import type { Env, Hono } from 'hono';

/**
 * What a plugin registers on under Hono: the Hono instance itself, so a plugin
 * uses the same `app.get(...)` and `app.route(...)` calls you would write by
 * hand.
 */
export type App<E extends Env = Env> = Hono<E>;
