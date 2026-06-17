import { z } from 'zod';

export const CleanQuery = z.object({
    page: z.number(),
});

export const CoercedQuery = z.object({
    page: z.coerce.number(),
});

export const DeprecatedLinkSchema = z.object({
    /**
     * @deprecated use {@link email_address} instead.
     */
    email: z.string(),
});

export const DuplicateDeprecatedSchema = z.object({
    /**
     * @deprecated First message.
     * @deprecated Second message.
     */
    email: z.string(),
});

export const NestedCoerced = z.object({
    filter: CoercedQuery,
});
