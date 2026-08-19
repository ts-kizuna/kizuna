import {
    boundJobKeys,
    flattenJobs,
    jobFnAt,
    jobRunnerFrom,
    runWebhookDelivery,
    JOBS_META,
    WEBHOOK_DELIVERY_JOB_KEY,
    WEBHOOKS_META,
    type JobDescriptor,
    type JobsMeta,
    type JobWorker,
    type WebhooksMeta,
} from './adapter.js';

export interface StartJobWorkerOptions {
    /**
     * Drain only these jobs, by dotted key.
     */
    only?: readonly string[];
    /**
     * Never drain these.
     */
    exclude?: readonly string[];
    /**
     * Where progress goes.
     *
     * @default console
     */
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

const wanted = (jobKey: string, options: StartJobWorkerOptions | undefined): boolean => {
    if (options?.only && !options.only.includes(jobKey)) return false;
    return !options?.exclude?.includes(jobKey);
};

/**
 * Drain a transport that stores queued work rather than running it itself.
 *
 * Returns `undefined` when the transport does not implement `start`.
 *
 * Each job message goes through the same runner `queue` writes to, so its input
 * is validated against the schema it lands on rather than the one it left, and
 * a rejection propagates for the transport to retry. Webhook deliveries queued
 * by `send` drain here too, under `kizuna:webhook-delivery`.
 *
 * @example
 * const worker = await startJobWorker(api);
 * process.on('SIGTERM', () => void worker?.stop());
 */
export const startJobWorker = async (api: unknown, options?: StartJobWorkerOptions): Promise<JobWorker | undefined> => {
    const logger = options?.logger ?? console;
    const jobsMeta = (api as { [JOBS_META]?: JobsMeta })[JOBS_META];
    const webhooksMeta = (api as { [WEBHOOKS_META]?: WebhooksMeta })[WEBHOOKS_META];

    const transport = jobsMeta?.transport ?? webhooksMeta?.transport;
    if (!transport?.start) return undefined;

    const runner = jobRunnerFrom(jobsMeta);

    const jobs: JobDescriptor[] = [];
    if (jobsMeta && runner) {
        // Subscribing to a job with no handler would take messages off the queue
        // that nothing can run.
        const bound = boundJobKeys(jobsMeta);
        for (const { jobKey } of flattenJobs(jobsMeta.jobs)) {
            if (!wanted(jobKey, options)) continue;
            if (!bound.has(jobKey)) {
                logger.warn(`[ts-kizuna] No handler was bound for job "${jobKey}", so the worker does not subscribe to it.`);
                continue;
            }
            jobs.push({
                job: jobKey,
            });
        }
    }
    if (webhooksMeta?.subscribers && wanted(WEBHOOK_DELIVERY_JOB_KEY, options)) {
        jobs.push({
            job: WEBHOOK_DELIVERY_JOB_KEY,
        });
    }

    logger.log(`[ts-kizuna] Draining ${jobs.length} job(s) from the "${transport.name}" transport.`);

    return transport.start({
        jobs,
        run: async (message) => {
            if (message.job === WEBHOOK_DELIVERY_JOB_KEY && webhooksMeta) {
                await runWebhookDelivery(webhooksMeta, message.input);
                return;
            }
            const jobFn = runner ? jobFnAt(runner, message.job) : undefined;
            if (!jobFn) throw new Error(`No handler is bound for job "${message.job}" on this contract.`);
            await jobFn.run(message.input);
        },
    });
};
