import type { z } from 'zod';
import type { Method } from './types.js';

type LowercaseLetter =
    | 'a'
    | 'b'
    | 'c'
    | 'd'
    | 'e'
    | 'f'
    | 'g'
    | 'h'
    | 'i'
    | 'j'
    | 'k'
    | 'l'
    | 'm'
    | 'n'
    | 'o'
    | 'p'
    | 'q'
    | 'r'
    | 's'
    | 't'
    | 'u'
    | 'v'
    | 'w'
    | 'x'
    | 'y'
    | 'z';
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/**
 * The characters {@link parsePath}'s `/:([a-zA-Z_][a-zA-Z0-9_]*)/` accepts.
 */
type IdentifierStart = LowercaseLetter | Uppercase<LowercaseLetter> | '_';
type IdentifierChar = IdentifierStart | Digit;

type TakeIdentifierRest<Text extends string, Name extends string> = Text extends `${infer Head}${infer Tail}`
    ? Head extends IdentifierChar
        ? TakeIdentifierRest<Tail, `${Name}${Head}`>
        : Name
    : Name;

type TakeIdentifier<Text extends string> = Text extends `${infer Head}${infer Tail}`
    ? Head extends IdentifierStart
        ? TakeIdentifierRest<Tail, Head>
        : ''
    : '';

/**
 * The `:param` names in a path, as a union. The type-level {@link parsePath}.
 */
export type PathParamName<Path extends string> = Path extends `${string}:${infer AfterColon}`
    ? TakeIdentifier<AfterColon> extends infer Name extends string
        ? Name extends ''
            ? PathParamName<AfterColon>
            : Name | PathParamName<AfterColon>
        : never
    : never;

export type ExtractPathParams<T extends string> = {
    [Name in PathParamName<T>]: string;
};

export type HasPathParams<T extends string> = [PathParamName<T>] extends [never] ? false : true;

/**
 * Resolves to `string` for schemas without a known key set, which switches the
 * check off.
 */
type DeclaredParamName<Schema> = Schema extends z.ZodType ? Extract<keyof z.output<Schema>, string> : never;

type UndeclaredParam<Path extends string, Schema> = Exclude<PathParamName<Path>, DeclaredParamName<Schema>>;
type UnmatchedParam<Path extends string, Schema> = Exclude<DeclaredParamName<Schema>, PathParamName<Path>>;

type PathParamsMismatch<Path extends string, Schema> =
    string extends DeclaredParamName<Schema>
        ? never
        : [UnmatchedParam<Path, Schema>] extends [never]
          ? [UndeclaredParam<Path, Schema>] extends [never]
              ? never
              : `ts-kizuna: path "${Path}" has parameter ":${UndeclaredParam<Path, Schema>}", which pathParams does not declare`
          : `ts-kizuna: pathParams declares "${UnmatchedParam<Path, Schema>}", which is not a parameter in path "${Path}"`;

/**
 * Every mismatch in a route tree, as a union. The `string extends keyof Node`
 * arm stops the walk at a generic that fell back to its constraint.
 */
type TreeMismatch<Node> = Node extends {
    method: Method;
    path: string;
}
    ? Node extends {
          path: infer Path extends string;
          pathParams: infer Schema;
      }
        ? PathParamsMismatch<Path, Schema>
        : never
    : Node extends object
      ? string extends keyof Node
          ? never
          : { [Key in keyof Node]: TreeMismatch<Node[Key]> }[keyof Node]
      : never;

type MismatchShape<Node> = {
    [Key in keyof Node]: Node[Key] extends {
        method: Method;
        path: infer Path extends string;
        pathParams: infer Schema;
    }
        ? [PathParamsMismatch<Path, Schema>] extends [never]
            ? unknown
            : {
                  pathParams: PathParamsMismatch<Path, Schema>;
              }
        : Node[Key] extends object
          ? MismatchShape<Node[Key]>
          : unknown;
};

/**
 * Reports routes whose `pathParams` keys disagree with their path's `:param`
 * placeholders. Intersect it with the inferred route tree
 * (`defs: T & PathParamsCheck<T>`): a clean tree gives `unknown`, leaving `T`
 * untouched, and a mismatch resolves the offending `pathParams` to an error
 * message. Routes that omit `pathParams` are left alone.
 */
export type PathParamsCheck<RouteTree> = [TreeMismatch<RouteTree>] extends [never] ? unknown : MismatchShape<RouteTree>;

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
