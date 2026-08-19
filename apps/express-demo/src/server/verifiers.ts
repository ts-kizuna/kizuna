import { createHmac, timingSafeEqual } from 'node:crypto';
import { server } from './server';

const secretFor = (variable: string): string => process.env[variable] ?? 'dev-webhook-secret';

const isDigestValid = (raw: Uint8Array, sent: string, secret: string): boolean => {
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    if (sent.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
};

export const verifyPayments = server.receiver.verify('payments', ({ raw, headers, deny }) => {
    const sent = headers['x-signature'] ?? '';
    const secret = secretFor('PAYMENTS_WEBHOOK_SECRET');
    if (!isDigestValid(raw, sent, secret)) {
        deny();
    }
});

export const verifySource = server.receiver.verify('source', ({ raw, headers, deny }) => {
    const sent = (headers['x-hub-signature-256'] ?? '').replace(/^sha256=/, '');
    const secret = secretFor('SOURCE_WEBHOOK_SECRET');
    if (!isDigestValid(raw, sent, secret)) {
        deny();
    }
});
