import type { InferModels } from '@ts-kizuna/core';
import type { contract } from './contract';

export declare const API: InferModels<typeof contract>;

export type User = typeof API.User;
