import type { z } from 'zod';
import type { RouteDefinition } from './types.js';
import type { ValidationStage } from './handler-pipeline.js';
import { coercionPlanFor, type CoercionPlan } from './coercion.js';
import { isVoidSchema } from './zod-internals.js';

/**
 * One of a route's validation stages, with its coercion plan resolved.
 */
export interface ValidationStep {
    stage: ValidationStage;
    schema: z.ZodType;
    coercionPlan: CoercionPlan;
}

/**
 * A guard the route requires: the security scheme's name and the scopes the
 * route demands of it.
 */
export interface SecurityRequirement {
    scheme: string;
    scopes: string[];
}

/**
 * How a route's request body is read.
 */
export interface BodyPlan {
    contentType: string;
    /**
     * Whether a request without a `content-type` header is acceptable, which it
     * is when the body schema accepts `undefined`: no content type is no
     * representation, not an unsupported one (RFC 9110 §15.5.16).
     */
    acceptsMissingContentType: boolean;
}

/**
 * Everything the request pipeline can know about a route before any request
 * arrives: which stages validate, which guards run, and how its body is read.
 * Resolved once per route, so a request re-derives none of it.
 */
export interface RoutePlan {
    validationSteps: ValidationStep[];
    securityRequirements: SecurityRequirement[];
    /**
     * `null` when the route takes no body.
     */
    body: BodyPlan | null;
    /**
     * Whether the route declares a query schema. Without one the pipeline never
     * reads the request's query, so adapters can parse it lazily.
     */
    hasQuerySchema: boolean;
}

/**
 * Expand a route's resolved `security` into the concrete (scheme, scopes) pairs
 * whose guards must run before the handler.
 */
export const resolveSecurityRequirements = (route: RouteDefinition): SecurityRequirement[] => {
    const requirements: SecurityRequirement[] = [];
    for (const entry of route.security ?? []) {
        if (typeof entry === 'string') {
            requirements.push({
                scheme: entry,
                scopes: [],
            });
            continue;
        }
        for (const [scheme, scopes] of Object.entries(entry)) {
            requirements.push({
                scheme,
                scopes: [...(scopes ?? [])],
            });
        }
    }
    return requirements;
};

const buildValidationSteps = (route: RouteDefinition): ValidationStep[] => {
    const steps: ValidationStep[] = [];
    if (route.pathParams) {
        steps.push({
            stage: 'params',
            schema: route.pathParams,
            coercionPlan: coercionPlanFor(route.pathParams),
        });
    }
    if (route.query) {
        steps.push({
            stage: 'query',
            schema: route.query,
            coercionPlan: coercionPlanFor(route.query),
        });
    }
    if (route.headers) {
        steps.push({
            stage: 'headers',
            schema: route.headers,
            coercionPlan: coercionPlanFor(route.headers),
        });
    }
    if (route.body) {
        steps.push({
            stage: 'body',
            schema: route.body,
            coercionPlan: null,
        });
    }
    return steps;
};

const buildBodyPlan = (route: RouteDefinition): BodyPlan | null => {
    if (!route.body || isVoidSchema(route.body)) return null;
    return {
        contentType: route.contentType ?? 'application/json',
        acceptsMissingContentType: route.body.safeParse(undefined).success,
    };
};

const plans = new WeakMap<RouteDefinition, RoutePlan>();

/**
 * The plan for a route, built on first sight and cached afterwards.
 * `assembleApi` fills the cache at startup, leaving the request path a single
 * `WeakMap` read.
 */
export const routePlanFor = (route: RouteDefinition): RoutePlan => {
    const cached = plans.get(route);
    if (cached !== undefined) return cached;
    const plan: RoutePlan = {
        validationSteps: buildValidationSteps(route),
        securityRequirements: resolveSecurityRequirements(route),
        body: buildBodyPlan(route),
        hasQuerySchema: route.query !== undefined,
    };
    plans.set(route, plan);
    return plan;
};
