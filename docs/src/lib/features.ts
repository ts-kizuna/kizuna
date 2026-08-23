import { ArrowLeftRight, Clock, FileText, KeyRound, Plug, Puzzle, Section, TriangleAlert, Zap } from 'lucide-react';
import KotlinLogo from '@/icons/Kotlin.svg';
import McpLogo from '@/icons/Mcp.svg';
import SwiftLogo from '@/icons/Swift.svg';
import TanstackLogo from '@/icons/TanStack.svg';
import type { ComponentType } from 'react';

type FeatureIcon = ComponentType<{ className?: string }>;

export interface Feature {
    icons: FeatureIcon[];
    title: string;
    href: string;
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
        href: '/docs/openapi',
        description: 'From the same contract, no annotations needed.',
    },
    {
        icons: [SwiftLogo, KotlinLogo],
        title: 'Native client generation',
        href: '/docs/clients/swift',
        description: 'Typed API clients for Swift (iOS/macOS) and Kotlin (Android/JVM).',
    },
    {
        icons: [McpLogo],
        title: 'MCP server generation',
        href: '/docs/mcp',
        description: 'Expose your API as MCP tools so AI assistants can call your endpoints.',
    },
    {
        icons: [TanstackLogo],
        title: 'TanStack Query',
        href: '/docs/clients/tanstack-query',
        description: 'Typed query and mutation options with caching and invalidation.',
    },
    {
        icons: [Plug],
        title: 'Adapters',
        href: '/docs/adapters/express',
        description: 'Mount your API on Express, Fastify, Hono, or Next.js.',
    },
    {
        icons: [KeyRound],
        title: 'Typed authentication',
        href: '/docs/authentication',
        description: 'Identities and per-route authentication declared on the contract.',
    },
    {
        icons: [Puzzle],
        title: 'Plugins',
        href: '/docs/plugins',
        description: 'Extend your API with features built on the contract you already wrote, fully typed in your handlers.',
    },
    {
        icons: [Clock],
        title: 'Scheduled jobs',
        href: '/docs/jobs',
        description: 'Declare cron work next to its handler and tick it from any platform scheduler, or run it in process.',
    },
    {
        icons: [Zap],
        title: 'RPC-like client',
        href: '/docs/clients/fetch',
        description: 'Call your API like a function, get fully typed responses back.',
    },
    {
        icons: [Section],
        title: 'Spec-driven everything',
        href: '/docs/standards',
        description: 'HTTP, OpenAPI, OAuth, and MCP: every status code, error body, and header sits where the spec says it should.',
    },
    {
        icons: [ArrowLeftRight],
        title: 'Built-in coercion',
        href: '/docs/building/contract',
        description: 'Query, path, and header params are coerced to their declared types. No manual parsing, no z.coerce.',
    },
    {
        icons: [TriangleAlert],
        title: 'Deprecation and sunset',
        href: '/docs/deprecations',
        description: 'Deprecate routes and fields, and it shows up in OpenAPI, Swift, Kotlin, and the response headers.',
    },
];
