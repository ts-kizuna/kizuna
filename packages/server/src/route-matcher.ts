import type { RouteDefinition, Routes, Method } from '@ts-kizuna/contract';
import { flattenRoutes } from '@ts-kizuna/contract';
import type { PathSegment } from '@ts-kizuna/shared';
import { parsePath } from '@ts-kizuna/shared';

interface CompiledRoute {
    routeKey: string;
    route: RouteDefinition;
    segments: PathSegment[];
    paramNames: string[];
    pattern: RegExp;
}

export interface RouteMatch {
    routeKey: string;
    route: RouteDefinition;
    params: Record<string, string>;
}

export type MatchResult = { kind: 'matched'; match: RouteMatch } | { kind: 'method-mismatch'; allowed: Method[] } | { kind: 'not-found' };

const REGEX_ESCAPE = /[.+?^${}()|[\]\\]/g;

const compileRoute = (routeKey: string, route: RouteDefinition): CompiledRoute => {
    const { segments, paramNames } = parsePath(route.path);
    let body = '';
    for (const segment of segments) {
        if (segment.kind === 'literal') {
            body += segment.value.replace(REGEX_ESCAPE, '\\$&');
        } else {
            body += '([^/]+)';
        }
    }
    return {
        routeKey,
        route,
        segments,
        paramNames,
        pattern: new RegExp(`^${body}$`),
    };
};

const cache = new WeakMap<Routes, CompiledRoute[]>();

const getCompiled = (routes: Routes): CompiledRoute[] => {
    const existing = cache.get(routes);
    if (existing) return existing;
    const fresh = flattenRoutes(routes).map(({ routeKey, route }) => compileRoute(routeKey, route));
    fresh.sort((a, b) => {
        const limit = Math.min(a.segments.length, b.segments.length);
        for (let index = 0; index < limit; index++) {
            const segmentA = a.segments[index]!;
            const segmentB = b.segments[index]!;
            if (segmentA.kind !== segmentB.kind) {
                return segmentA.kind === 'literal' ? -1 : 1;
            }
        }
        return a.paramNames.length - b.paramNames.length;
    });
    cache.set(routes, fresh);
    return fresh;
};

const stripBasePath = (pathname: string, basePath: string | undefined): string => {
    if (!basePath) return pathname;
    const trimmed = basePath.replace(/\/+$/, '');
    if (pathname === trimmed) return '/';
    if (pathname.startsWith(trimmed + '/')) return pathname.slice(trimmed.length);
    return pathname;
};

export const sortFlattenedRoutes = <T extends { route: RouteDefinition }>(routes: T[]): T[] => {
    const parsed = routes.map((entry) => ({ entry, ...parsePath(entry.route.path) }));
    parsed.sort((a, b) => {
        const limit = Math.min(a.segments.length, b.segments.length);
        for (let index = 0; index < limit; index++) {
            const segmentA = a.segments[index]!;
            const segmentB = b.segments[index]!;
            if (segmentA.kind !== segmentB.kind) {
                return segmentA.kind === 'literal' ? -1 : 1;
            }
        }
        return a.paramNames.length - b.paramNames.length;
    });
    return parsed.map((p) => p.entry);
};

export const matchRoute = (method: string, pathname: string, routes: Routes, basePath?: string): MatchResult => {
    const target = stripBasePath(pathname, basePath);
    const compiled = getCompiled(routes);
    const allowed = new Set<Method>();
    for (const candidate of compiled) {
        const result = candidate.pattern.exec(target);
        if (!result) continue;
        if (candidate.route.method !== method) {
            allowed.add(candidate.route.method);
            continue;
        }
        const params: Record<string, string> = {};
        candidate.paramNames.forEach((name, index) => {
            const captured = result[index + 1];
            if (captured !== undefined) params[name] = decodeURIComponent(captured);
        });
        return {
            kind: 'matched',
            match: {
                routeKey: candidate.routeKey,
                route: candidate.route,
                params,
            },
        };
    }
    if (allowed.size > 0) {
        return {
            kind: 'method-mismatch',
            allowed: Array.from(allowed),
        };
    }
    return {
        kind: 'not-found',
    };
};
