import { createHmac, timingSafeEqual } from 'node:crypto';
import { server } from './server';

const isDigestValid = (raw: Uint8Array, sent: string): boolean => {
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET ?? 'dev-webhook-secret';
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    if (sent.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
};

export const verifyPayments = server.receiver.verify('payments', ({ raw, headers, deny }) => {
    if (!isDigestValid(raw, headers['x-signature'] ?? '')) {
        deny();
    }
});
