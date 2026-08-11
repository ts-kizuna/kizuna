import { z } from 'zod';
import { cron } from '@ts-kizuna/core';
import { k } from './k.js';

/**
 * The API's scheduled jobs, grouped the way a real contract would be.
 */
export const jobs = k.jobs('scheduler', {
    users: {
        sendDigests: {
            schedule: cron.daily('05:00'),
            summary: 'Send the daily digest to every user',
            result: z.object({
                sent: z.int(),
            }),
        },
        indexUser: {
            summary: 'Re-index one user, queued when that user changes',
            retry: 3,
            input: z.object({
                userId: z.string(),
            }),
            result: z.object({
                indexed: z.boolean(),
            }),
        },
    },
    workspaces: {
        reconcile: {
            schedule: cron.every('15m'),
            summary: 'Reconcile workspace memberships',
            result: z.object({
                reconciled: z.int(),
            }),
        },
        expireInvites: {
            schedule: {
                cron: '0 3 * * *',
                timezone: 'Europe/Oslo',
            },
            summary: 'Drop invites past their expiry',
        },
    },
});
