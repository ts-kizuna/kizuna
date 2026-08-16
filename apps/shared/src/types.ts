import type { z } from 'zod';
import type { UserSchema } from './routes/users';

export type User = z.infer<typeof UserSchema>;
