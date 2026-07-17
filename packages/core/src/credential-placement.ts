import type { SecurityScheme } from './security-scheme.js';
import type { BearerCredential, BasicCredential, ApiKeyCredential, CredentialOf } from './identity.js';

export interface CredentialSink {
    header: (name: string, value: string) => void;
    query: (name: string, value: string) => void;
}

export type CredentialValue = string | { username: string; password: string };

export interface SchemePlacement {
    name: string;
    kind: 'bearer' | 'basic' | 'apiKeyHeader' | 'apiKeyQuery' | 'apiKeyCookie';
    parameterName?: string;
}

export const resolveSchemePlacements = (schemes: Record<string, SecurityScheme> | undefined): Map<string, SchemePlacement> => {
    const placements = new Map<string, SchemePlacement>();
    for (const [name, scheme] of Object.entries(schemes ?? {})) {
        const openapi = scheme.openapi;
        if (!openapi) continue;
        if (openapi.type === 'apiKey') {
            const kind = openapi.in === 'query' ? 'apiKeyQuery' : openapi.in === 'cookie' ? 'apiKeyCookie' : 'apiKeyHeader';
            placements.set(name, { name, kind, parameterName: openapi.name });
        } else if (openapi.type === 'http' && openapi.scheme === 'basic') {
            placements.set(name, { name, kind: 'basic' });
        } else {
            placements.set(name, { name, kind: 'bearer' });
        }
    }
    return placements;
};

export const describeSchemePlacement = (placement: SchemePlacement): string => {
    switch (placement.kind) {
        case 'bearer':
            return 'Bearer token, sent as the `Authorization: Bearer` header.';
        case 'basic':
            return 'Basic credentials, sent as the `Authorization: Basic` header.';
        case 'apiKeyHeader':
            return `API key, sent as the \`${placement.parameterName}\` header.`;
        case 'apiKeyQuery':
            return `API key, sent as the \`${placement.parameterName}\` query parameter.`;
        case 'apiKeyCookie':
            return `API key, sent as the \`${placement.parameterName}\` cookie.`;
    }
};

const base64Utf8 = (input: string): string => {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

export const placeCredential = (scheme: SecurityScheme, value: CredentialValue, sink: CredentialSink): void => {
    const openapi = scheme.openapi;
    if (!openapi) return;

    if (openapi.type === 'apiKey') {
        if (typeof value !== 'string') return;
        if (openapi.in === 'query') sink.query(openapi.name, value);
        else if (openapi.in === 'cookie') sink.header('Cookie', `${openapi.name}=${value}`);
        else sink.header(openapi.name, value);
        return;
    }

    if (openapi.type === 'http' && openapi.scheme === 'basic') {
        if (typeof value === 'string') return;
        sink.header('Authorization', `Basic ${base64Utf8(`${value.username}:${value.password}`)}`);
        return;
    }

    if (typeof value !== 'string') return;
    sink.header('Authorization', `Bearer ${value}`);
};

export type CredentialInput<Id> =
    CredentialOf<Id> extends { basic: BasicCredential | null }
        ? { username: string; password: string }
        : CredentialOf<Id> extends { apiKey: ApiKeyCredential | null }
          ? string
          : CredentialOf<Id> extends { bearer: BearerCredential | null }
            ? string
            : CredentialOf<Id> extends { oauth2: BearerCredential | null }
              ? string
              : CredentialOf<Id> extends { openIdConnect: BearerCredential | null }
                ? string
                : never;

export type CredentialProvider<Input> = () => Input | null | Promise<Input | null>;

export type ClientAuth<Schemes extends Record<string, SecurityScheme>> = {
    [Name in keyof Schemes as [CredentialInput<Schemes[Name]>] extends [never] ? never : Name]?: CredentialProvider<
        CredentialInput<Schemes[Name]>
    >;
};
