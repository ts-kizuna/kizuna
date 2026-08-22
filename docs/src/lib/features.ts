import { ArrowLeftRight, Clock, FileText, Globe, KeyRound, Plug, Puzzle, TriangleAlert, Zap } from 'lucide-react';
import { KotlinLogo, McpLogo, SwiftLogo, TanstackLogo } from '@/components/code/brand-icons';
import type { ComponentType } from 'react';

type FeatureIcon = ComponentType<{ className?: string }>;

export interface Feature {
    icons: FeatureIcon[];
    title: string;
    /**
     * Plain-text summary. Kept free of markup so the same string renders in
     * both the landing cards and the docs bullet list.
     */
    description: string;
}

export const features: Feature[] = [
    {
        icons: [FileText],
        title: 'OpenAPI generation',
        description: 'From the same contract, no annotations needed.',
    },
    {
        icons: [SwiftLogo, KotlinLogo],
        title: 'Native client generation',
        description: 'Typed API clients for Swift (iOS/macOS) and Kotlin (Android/JVM).',
    },
    {
        icons: [McpLogo],
        title: 'MCP server generation',
        description: 'Expose your API as MCP tools so AI assistants can call your endpoints.',
    },
    {
        icons: [TanstackLogo],
        title: 'TanStack Query',
        description: 'Typed query and mutation options with caching and invalidation.',
    },
    {
        icons: [Plug],
        title: 'Adapters',
        description: 'Mount your API on Express, Fastify, Hono, or Next.js.',
    },
    {
        icons: [KeyRound],
        title: 'Typed authentication',
        description: 'Identities and per-route authentication declared on the contract.',
    },
    {
        icons: [Puzzle],
        title: 'Plugins',
        description: 'Extend your API with features built on the contract you already wrote, fully typed in your handlers.',
    },
    {
        icons: [Clock],
        title: 'Scheduled jobs',
        description: 'Declare cron work next to its handler and tick it from any platform scheduler, or run it in process.',
    },
    {
        icons: [Zap],
        title: 'RPC-like client',
        description: 'Call your API like a function, get fully typed responses back.',
    },
    {
        icons: [Globe],
        title: 'HTTP/REST',
        description: 'Follows HTTP and REST standards. RFC 9110 semantics, RFC 9457 Problem Details.',
    },
    {
        icons: [ArrowLeftRight],
        title: 'Built-in coercion',
        description: 'Query, path, and header params are coerced to their declared types. No manual parsing, no z.coerce.',
    },
    {
        icons: [TriangleAlert],
        title: 'Deprecation support',
        description: 'Deprecate endpoints and fields on the contract, and your editor, OpenAPI, Swift, and Kotlin all pick it up.',
    },
];
