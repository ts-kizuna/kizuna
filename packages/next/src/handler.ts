import {
    type AdapterRequest,
    type AdapterResult,
    type RouteDefinition,
    type Contract,
    type RouteHandler as CoreRouteHandler,
    type Router as CoreRouter,
    createAdapter,
    headersToObject,
    parseFetchBody,
    renderJsonResult,
} from '@ts-kizuna/core/adapter';
import { type NextRequest, NextResponse } from 'next/server';

export interface NextHandlerContext {
    request: NextRequest;
}

export type RouteHandler<R extends RouteDefinition> = CoreRouteHandler<R, NextHandlerContext>;
export type Router<T extends Contract> = CoreRouter<T, NextHandlerContext>;

export interface NextHandlerOptions {
    basePath?: string;
    onError?: (error: unknown, request: NextRequest) => NextResponse | Promise<NextResponse> | void | Promise<void>;
    /**
     * Emit error responses as RFC 9457 Problem Details (`application/problem+json`).
     *
     * When `true`, all non-2xx ts-kizuna error responses use the standard
     * `{ type, title, status, detail }` shape. Set to `false` to revert to the
     * legacy `{ message, issues }` format.
     *
     * See https://www.rfc-editor.org/rfc/rfc9457
     *
     * @default true
     */
    problemDetailsEnabled?: boolean;
    /**
     * Validate handler return values against the contract's response schemas.
     * Mismatches surface as 500 errors. Intended for development; disable in production.
     *
     * @default false
     */
    responseValidation?: boolean;
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string>): NextResponse =>
    new NextResponse(body === null || body === undefined ? null : JSON.stringify(body), {
        status,
        headers,
    });

export const handleNextRequest = async <T extends Contract>(
    request: NextRequest,
    contract: T,
    router: Router<T>,
    options?: NextHandlerOptions
): Promise<NextResponse> => {
    const url = new URL(request.url);

    const adapter = createAdapter<NextRequest, NextResponse, NextHandlerContext>({
        buildHandlerContext: (adapterRequest) => ({
            request: adapterRequest.request,
        }),
        respond: (result) => {
            if (result.kind === 'raw-response') return result.response as NextResponse;
            const rendered = renderJsonResult(result, {
                problemDetailsEnabled: options?.problemDetailsEnabled,
            });
            return jsonResponse(rendered.status, rendered.body, rendered.headers);
        },
        onError: async (error): Promise<AdapterResult | void> => {
            if (!options?.onError) {
                console.error('[ts-kizuna/next] handler error:', error);
                return;
            }
            const override = await options.onError(error, request);
            if (override) {
                return {
                    kind: 'raw-response',
                    response: override,
                };
            }
        },
    });

    const adapterRequest: AdapterRequest<NextRequest> = {
        request,
        method: request.method,
        resolution: {
            kind: 'core-match',
            path: url.pathname,
        },
        query: Object.fromEntries(url.searchParams),
        headers: headersToObject(request.headers),
        readBody: (route) => parseFetchBody(request, route),
    };

    return adapter.handle({
        contract,
        router,
        request: adapterRequest,
        responseContext: {},
        basePath: options?.basePath,
        responseValidation: options?.responseValidation,
    });
};
