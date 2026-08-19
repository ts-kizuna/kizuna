import { server } from './server';

/**
 * A real app reads subscriptions from its database. The demo takes one
 * endpoint from the environment, so a local receiver can watch deliveries.
 */
export const webhookConfig = server.webhooks({
    subscribers: () =>
        process.env.WEBHOOK_URL
            ? [
                  {
                      url: process.env.WEBHOOK_URL,
                      secret: process.env.WEBHOOK_SECRET ?? 'whsec_demo',
                  },
              ]
            : [],
});
