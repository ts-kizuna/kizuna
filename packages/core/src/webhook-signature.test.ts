import { createHmac, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentDigest, signatureBase, signDelivery, verifyDelivery } from './webhook-signature.js';

const base = {
    secret: 'whsec_test',
    body: '{"id":"in_1","amount":500}',
    url: 'https://example.com/hooks/kizuna',
    method: 'POST',
    timestamp: 1_755_600_000,
};

describe('contentDigest', () => {
    it('is the RFC 9530 sha-256 dictionary member for the body', async () => {
        const expected = createHash('sha256').update(base.body, 'utf8').digest('base64');
        expect(await contentDigest(base.body)).toBe(`sha-256=:${expected}:`);
    });
});

describe('signDelivery with hmac-sha256', () => {
    const sign = () => signDelivery({ ...base, scheme: 'hmac-sha256' });

    it('carries the timestamp it signed', async () => {
        expect((await sign())['webhook-timestamp']).toBe(String(base.timestamp));
    });

    it('signs the timestamp and the body, joined by a dot', async () => {
        const expected = createHmac('sha256', base.secret).update(`${base.timestamp}.${base.body}`, 'utf8').digest('hex');
        expect((await sign())['webhook-signature']).toBe(`v1=${expected}`);
    });

    it('changes when the body changes', async () => {
        const other = await signDelivery({ ...base, scheme: 'hmac-sha256', body: '{"id":"in_2"}' });
        expect(other['webhook-signature']).not.toBe((await sign())['webhook-signature']);
    });
});

describe('signDelivery with rfc9421', () => {
    const sign = () => signDelivery({ ...base, scheme: 'rfc9421' });

    it('covers the method, target, and content digest', async () => {
        expect((await sign())['signature-input']).toBe(
            `sig1=("@method" "@target-uri" "content-digest");created=${base.timestamp};keyid="kizuna";alg="hmac-sha256"`
        );
    });

    it('sends the digest of the body alongside', async () => {
        expect((await sign())['content-digest']).toBe(await contentDigest(base.body));
    });

    it('signs the signature base, wrapped as a byte sequence', async () => {
        const expected = createHmac('sha256', base.secret)
            .update(await signatureBase({ ...base, keyId: 'kizuna' }), 'utf8')
            .digest('base64');
        expect((await sign()).signature).toBe(`sig1=:${expected}:`);
    });

    it('names the key when one is given', async () => {
        const withKey = await signDelivery({ ...base, scheme: 'rfc9421', keyId: 'sub_42' });
        expect(withKey['signature-input']).toContain('keyid="sub_42"');
    });

    it('builds the base as one line per component, ending with the parameters', async () => {
        expect((await signatureBase({ ...base, keyId: 'kizuna' })).split('\n')).toEqual([
            '"@method": POST',
            `"@target-uri": ${base.url}`,
            `"content-digest": ${await contentDigest(base.body)}`,
            `"@signature-params": ("@method" "@target-uri" "content-digest");created=${base.timestamp};keyid="kizuna";alg="hmac-sha256"`,
        ]);
    });
});

describe('verifyDelivery', () => {
    const now = base.timestamp * 1000;

    for (const scheme of ['rfc9421', 'hmac-sha256'] as const) {
        it(`accepts what signDelivery produced for ${scheme}`, async () => {
            const headers = await signDelivery({ ...base, scheme });
            expect(await verifyDelivery({ ...base, scheme, headers, now })).toBe(true);
        });

        it(`rejects a signature made with another secret for ${scheme}`, async () => {
            const headers = await signDelivery({ ...base, scheme, secret: 'whsec_other' });
            expect(await verifyDelivery({ ...base, scheme, headers, now })).toBe(false);
        });

        it(`rejects a delivery whose body was changed for ${scheme}`, async () => {
            const headers = await signDelivery({ ...base, scheme });
            expect(await verifyDelivery({ ...base, scheme, body: '{"id":"tampered"}', headers, now })).toBe(false);
        });

        it(`rejects a delivery carrying no signature for ${scheme}`, async () => {
            expect(await verifyDelivery({ ...base, scheme, headers: {}, now })).toBe(false);
        });
    }

    it('reads the timestamp out of the headers when it is not given', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421' });
        expect(
            await verifyDelivery({
                ...base,
                timestamp: undefined,
                scheme: 'rfc9421',
                headers,
                now,
            })
        ).toBe(true);
    });

    it('rejects a delivery older than the tolerance window, so it cannot be replayed', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421' });
        expect(
            await verifyDelivery({
                ...base,
                scheme: 'rfc9421',
                headers,
                now: now + 600_000,
            })
        ).toBe(false);
    });

    it('accepts headers however they are cased', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421' });
        expect(
            await verifyDelivery({
                ...base,
                scheme: 'rfc9421',
                headers: {
                    'Content-Digest': headers['content-digest'] as string,
                    'Signature-Input': headers['signature-input'] as string,
                    Signature: headers.signature as string,
                },
                now,
            })
        ).toBe(true);
    });

    it('reads the keyid out of the headers when it is not given', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421', keyId: 'live-2026' });
        expect(await verifyDelivery({ ...base, scheme: 'rfc9421', headers, now })).toBe(true);
    });

    it('rejects a delivery naming a keyid other than the expected one', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421', keyId: 'live-2026' });
        expect(await verifyDelivery({ ...base, scheme: 'rfc9421', keyId: 'live-2027', headers, now })).toBe(false);
    });

    it('rejects an rfc9421 delivery whose URL changed', async () => {
        const headers = await signDelivery({ ...base, scheme: 'rfc9421' });
        expect(
            await verifyDelivery({
                ...base,
                scheme: 'rfc9421',
                url: 'https://elsewhere.example/hooks',
                headers,
                now,
            })
        ).toBe(false);
    });
});
