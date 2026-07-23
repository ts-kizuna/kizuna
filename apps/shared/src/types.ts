import type { z } from 'zod';
import type { UserSchema } from './routes.js';

export type User = z.infer<typeof UserSchema>;
