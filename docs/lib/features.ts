import {
    ArrowLeftRight,
    Clock,
    BotMessageSquare,
    FileText,
    Globe,
    KeyRound,
    Plug,
    Puzzle,
    ScrollText,
    Smartphone,
    TriangleAlert,
    Zap,
} from 'lucide-react';
import { KotlinLogo, McpLogo, SwiftLogo } from './brand-icons';
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
        icons: [ScrollText],
        title: 'Contract-first',
        description: 'Define request and response schemas once, share them between server and client.',
    },
    {
        icons: [KeyRound],
        title: 'Typed auth',
        description: 'Identities and per-route auth declared on the contract.',
    },
    {
        icons: [Plug],
        title: 'Adapters',
        description: 'Mount your API on Express, Fastify, Hono, or Next.js.',
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
        description: 'Mark endpoints and fields with a JSDoc @deprecated tag. IDEs, OpenAPI, Swift, and Kotlin all pick it up.',
    },
];
