import { z } from "zod";
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    /**
     * The user's email address.
     * @example "a@b.com"
     * @deprecated use email_address
     */
    email: z.ZodString;
}, z.core.$strip>;
export type User = z.infer<typeof UserSchema>;
