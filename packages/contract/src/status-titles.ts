/**
 * RFC 9110 status code reason phrases.
 *
 * The single source of truth for human-readable status phrases across kizuna ,
 * used for Problem Details `title` fields and OpenAPI response descriptions.
 */
export const STATUS_TITLES: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    409: 'Conflict',
    410: 'Gone',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
};

/**
 * Human-readable text for an HTTP status code.
 *
 * Falls back to `<status> Response` for codes not in {@link STATUS_TITLES}, so
 * callers that require a non-empty string (e.g. OpenAPI response descriptions)
 * always get one.
 */
export const getStatusText = (status: number): string => STATUS_TITLES[status] ?? `${status} Response`;
