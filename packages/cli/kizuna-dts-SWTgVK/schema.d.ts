import { z } from "zod";
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    /** The primary contact email. */
    email: z.ZodString;
}, z.core.$strip>;
export type User = z.infer<typeof UserSchema>;
