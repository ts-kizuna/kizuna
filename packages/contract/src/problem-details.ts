import { STATUS_TITLES } from './status-titles.js';

export interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
}

/**
 * Build an RFC 9457 Problem Details body.
 *
 * ```ts
 * import { problemDetails } from './problem-details.js';
 *
 * return throwError({
 *     status: 404,
 *     body: problemDetails(404, 'User not found'),
 * });
 * ```
 */
export const problemDetails = <T extends Record<string, unknown> = Record<string, never>>(
    status: number,
    detail: string,
    extensions?: T
): ProblemDetails & T => ({
    type: 'about:blank',
    title: STATUS_TITLES[status] ?? 'Unknown Error',
    status,
    detail,
    ...((extensions as T) ?? ({} as T)),
});
