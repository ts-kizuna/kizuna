import { z } from 'zod';
import type { ResponseHeaders, RouteDefinition, Routes } from './types.js';
import { flattenRoutes } from './handler-pipeline.js';

/**
 * An ISO 8601 date, or date-time with an offset. A date alone means midnight UTC.
 */
const IsoDateSchema = z.union([
    z.iso.date(),
    z.iso.datetime({
        offset: true,
    }),
]);

const isIso8601 = (value: string): boolean => IsoDateSchema.safeParse(value).success;

/**
 * The `Deprecation`, `Sunset`, and `Link` headers a route announces its
 * deprecation and sunset dates with, keyed lowercase. Empty for a route that
 * declares neither.
 */
export const deprecationHeaders = (route: RouteDefinition): ResponseHeaders => {
    const headers: ResponseHeaders = {};
    const links: string[] = [];
    if (route.deprecated && typeof route.deprecated === 'object') {
        if (route.deprecated.date !== undefined) {
            headers['deprecation'] = `@${Math.floor(Date.parse(route.deprecated.date) / 1000)}`;
        }
        if (route.deprecated.link !== undefined) {
            links.push(`<${route.deprecated.link}>; rel="deprecation"`);
        }
    }
    if (route.sunset !== undefined) {
        const sunset = typeof route.sunset === 'string' ? { date: route.sunset } : route.sunset;
        headers['sunset'] = new Date(sunset.date).toUTCString();
        if (sunset.link !== undefined) {
            links.push(`<${sunset.link}>; rel="sunset"`);
        }
    }
    if (links.length > 0) headers['link'] = links.join(', ');
    return headers;
};

/**
 * Rejects a `deprecated.date` or `sunset` that does not parse as ISO 8601.
 * Called by `k.contract`, so a bad date fails at contract assembly rather than
 * on the first response.
 */
export const assertValidDeprecationDates = (routes: Routes): void => {
    for (const { routeKey, route } of flattenRoutes(routes)) {
        if (route.deprecated && typeof route.deprecated === 'object' && route.deprecated.date !== undefined) {
            if (!isIso8601(route.deprecated.date)) {
                throw new Error(
                    `Route '${routeKey}' declares deprecated.date '${route.deprecated.date}', which is not an ISO 8601 date or timestamp.`
                );
            }
        }
        if (route.sunset !== undefined) {
            const date = typeof route.sunset === 'string' ? route.sunset : route.sunset.date;
            if (!isIso8601(date)) {
                throw new Error(`Route '${routeKey}' declares a sunset of '${date}', which is not an ISO 8601 date or timestamp.`);
            }
        }
    }
};
