import { DEFAULT_WEBHOOK_TOLERANCE_MS, type WebhookSignatureScheme } from './webhooks.js';

export interface SignDeliveryOptions {
    scheme: WebhookSignatureScheme;
    secret: string;
    /**
     * The exact body bytes being posted, as the string that goes on the wire.
     */
    body: string;
    /**
     * The absolute URL being posted to. Covered by an `rfc9421` signature.
     */
    url: string;
    method: string;
    /**
     * Seconds since the epoch.
     */
    timestamp: number;
    keyId?: string;
}

const encoder = new TextEncoder();

const toBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const toHex = (buffer: ArrayBuffer): string => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const hmacSha256 = async (secret: string, payload: string): Promise<ArrayBuffer> => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', key, encoder.encode(payload));
};

/**
 * The `Content-Digest` value for a body, per RFC 9530.
 */
export const contentDigest = async (body: string): Promise<string> =>
    `sha-256=:${toBase64(await crypto.subtle.digest('SHA-256', encoder.encode(body)))}:`;

const signatureParams = (timestamp: number, keyId: string): string =>
    `("@method" "@target-uri" "content-digest");created=${timestamp};keyid="${keyId}";alg="hmac-sha256"`;

/**
 * The signature base an RFC 9421 signature is computed over, per its section
 * 2.5: one line per covered component, then `@signature-params`, joined by
 * newlines with none trailing.
 */
export const signatureBase = async (
    options: Pick<SignDeliveryOptions, 'method' | 'url' | 'body' | 'timestamp'> & { keyId: string }
): Promise<string> =>
    [
        `"@method": ${options.method.toUpperCase()}`,
        `"@target-uri": ${options.url}`,
        `"content-digest": ${await contentDigest(options.body)}`,
        `"@signature-params": ${signatureParams(options.timestamp, options.keyId)}`,
    ].join('\n');

/**
 * The headers that carry a delivery's signature.
 *
 * @example
 * const headers = await signDelivery({
 *     scheme: 'rfc9421',
 *     secret: subscription.signingSecret,
 *     body: JSON.stringify(payload),
 *     url: subscription.url,
 *     method: 'POST',
 *     timestamp: Math.floor(Date.now() / 1000),
 * });
 */
export const signDelivery = async (options: SignDeliveryOptions): Promise<Record<string, string>> => {
    if (options.scheme === 'hmac-sha256') {
        return {
            'webhook-timestamp': String(options.timestamp),
            'webhook-signature': `v1=${toHex(await hmacSha256(options.secret, `${options.timestamp}.${options.body}`))}`,
        };
    }
    const keyId = options.keyId ?? 'kizuna';
    const base = await signatureBase({
        method: options.method,
        url: options.url,
        body: options.body,
        timestamp: options.timestamp,
        keyId,
    });
    return {
        'content-digest': await contentDigest(options.body),
        'signature-input': `sig1=${signatureParams(options.timestamp, keyId)}`,
        signature: `sig1=:${toBase64(await hmacSha256(options.secret, base))}:`,
    };
};

const equals = (left: string, right: string): boolean => {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
};

const normalizeHeaders = (headers: Record<string, string | undefined>): Record<string, string | undefined> =>
    Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

/**
 * The delivery's own timestamp, read back out of the headers that carry it.
 */
const timestampFrom = (scheme: WebhookSignatureScheme, headers: Record<string, string | undefined>): number | undefined => {
    if (scheme === 'hmac-sha256') {
        const raw = headers['webhook-timestamp'];
        return raw === undefined ? undefined : Number(raw);
    }
    const created = /created=(\d+)/.exec(headers['signature-input'] ?? '')?.[1];
    return created === undefined ? undefined : Number(created);
};

/**
 * The `keyid` the delivery's own `signature-input` names.
 */
const keyIdFrom = (headers: Record<string, string | undefined>): string | undefined =>
    /keyid="([^"]*)"/.exec(headers['signature-input'] ?? '')?.[1];

export interface VerifyDeliveryOptions extends Omit<SignDeliveryOptions, 'timestamp'> {
    headers: Record<string, string | undefined>;
    /**
     * The `keyid` the signature must carry. Taken from the headers when omitted;
     * a delivery naming a different one fails verification.
     */
    keyId?: string;
    /**
     * Taken from the headers when omitted.
     */
    timestamp?: number;
    /**
     * How far out of date the delivery may be, so a captured one cannot be
     * replayed tomorrow. `0` skips the check.
     *
     * @default 300000
     */
    toleranceMs?: number;
    now?: number;
}

/**
 * Whether a received delivery carries a signature this secret produces, and is
 * recent enough. Compares in constant time.
 *
 * @example
 * const trusted = await verifyDelivery({
 *     scheme: 'rfc9421',
 *     secret: process.env.WEBHOOK_SECRET,
 *     body: rawBody,
 *     url: 'https://example.com/hooks',
 *     method: 'POST',
 *     headers,
 * });
 */
export const verifyDelivery = async (options: VerifyDeliveryOptions): Promise<boolean> => {
    const headers = normalizeHeaders(options.headers);
    const timestamp = options.timestamp ?? timestampFrom(options.scheme, headers);
    if (timestamp === undefined || !Number.isFinite(timestamp)) return false;
    const tolerance = options.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS;
    if (tolerance > 0 && Math.abs((options.now ?? Date.now()) - timestamp * 1000) > tolerance) return false;

    const receivedKeyId = keyIdFrom(headers);
    if (options.keyId !== undefined && receivedKeyId !== undefined && receivedKeyId !== options.keyId) return false;

    const expected = await signDelivery({ ...options, timestamp, keyId: receivedKeyId ?? options.keyId });
    const name = options.scheme === 'hmac-sha256' ? 'webhook-signature' : 'signature';
    const received = headers[name];
    if (typeof received !== 'string') return false;
    return equals(received, expected[name] as string);
};
