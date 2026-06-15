export type ExtractPathParams<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractPathParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

export type HasPathParams<T extends string> = T extends `${string}:${string}` ? true : false;

export interface PathSegment {
    kind: 'literal' | 'param';
    value: string;
}

export const parsePath = (path: string): { segments: PathSegment[]; paramNames: string[] } => {
    const segments: PathSegment[] = [];
    const paramNames: string[] = [];
    const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(path)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                kind: 'literal',
                value: path.slice(lastIndex, match.index),
            });
        }
        segments.push({
            kind: 'param',
            value: match[1]!,
        });
        paramNames.push(match[1]!);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < path.length) {
        segments.push({
            kind: 'literal',
            value: path.slice(lastIndex),
        });
    }
    return {
        segments,
        paramNames,
    };
};

export const buildPath = (path: string, params?: Record<string, string | number | bigint | Date>): string => {
    const { segments } = parsePath(path);
    let out = '';
    for (const segment of segments) {
        if (segment.kind === 'literal') {
            out += segment.value;
            continue;
        }
        const value = params?.[segment.value];
        if (value === undefined) throw new Error(`Missing path parameter: ${segment.value}`);
        // Dates go on the wire as ISO 8601; everything else stringifies.
        out += encodeURIComponent(value instanceof Date ? value.toISOString() : String(value));
    }
    return out;
};
