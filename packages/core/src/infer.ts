import type { MODEL_TITLE } from './model.js';
import type { Routes, RouteDefinition } from './types.js';
import type { Jobs, JobDefinition } from './jobs.js';

type UnionToIntersection<Union> = (Union extends unknown ? (member: Union) => void : never) extends (member: infer Merged) => void
    ? Merged
    : never;

type Flatten<T> = {
    [Key in keyof T]: T[Key];
} & {};

type OutputOf<Schema> = Schema extends {
    _zod: {
        output: infer Output;
    };
}
    ? Output
    : never;

/**
 * Every model a schema names, itself included, as a union of one-key records.
 */
type ModelsInSchema<Schema> =
    | (Schema extends {
          readonly [MODEL_TITLE]: infer Title extends string;
      }
          ? {
                [Key in Title]: OutputOf<Schema>;
            }
          : never)
    | ModelsInSchemaChildren<Schema>;

/**
 * The models a schema wraps: an object's fields, an array's element, a union's
 * options, and so on down to the leaves.
 */
type ModelsInSchemaChildren<Schema> = Schema extends {
    shape: infer Shape;
}
    ? {
          [Key in keyof Shape]: ModelsInSchema<Shape[Key]>;
      }[keyof Shape]
    : Schema extends {
            element: infer Element;
        }
      ? ModelsInSchema<Element>
      : Schema extends {
              options: infer Options extends readonly unknown[];
          }
        ? ModelsInSchema<Options[number]>
        : Schema extends {
                in: infer Input;
                out: infer Output;
            }
          ? ModelsInSchema<Input> | ModelsInSchema<Output>
          : Schema extends {
                  keyType: infer Key;
                  valueType: infer Value;
              }
            ? ModelsInSchema<Key> | ModelsInSchema<Value>
            : Schema extends {
                    unwrap: () => infer Inner;
                }
              ? ModelsInSchema<Inner>
              : Schema extends {
                      _zod: {
                          def: {
                              left: infer Left;
                              right: infer Right;
                          };
                      };
                  }
                ? ModelsInSchema<Left> | ModelsInSchema<Right>
                : Schema extends {
                        _zod: {
                            def: {
                                items: infer Items extends readonly unknown[];
                                rest: infer Rest;
                            };
                        };
                    }
                  ? ModelsInSchema<Items[number]> | ModelsInSchema<Rest>
                  : never;

type ModelsInRoute<Route extends RouteDefinition> =
    | ModelsInSchema<Route['body']>
    | ModelsInSchema<Route['query']>
    | ModelsInSchema<Route['pathParams']>
    | ModelsInSchema<Route['headers']>
    | ModelsInResponses<Route['responses']>;

type ModelsInResponses<Responses> = {
    [Status in keyof Responses]: Responses[Status] extends {
        body: infer Body;
        headers?: infer Headers;
    }
        ? ModelsInSchema<Body> | ModelsInSchema<Headers>
        : ModelsInSchema<Responses[Status]>;
}[keyof Responses];

type ModelsInRoutes<Tree> = {
    [Key in keyof Tree]: Tree[Key] extends RouteDefinition ? ModelsInRoute<Tree[Key]> : ModelsInRoutes<Tree[Key]>;
}[keyof Tree];

type ModelsInJobs<Tree> = {
    [Key in keyof Tree]: Tree[Key] extends {
        definition: infer Definition extends JobDefinition;
        responses: infer Responses;
    }
        ? ModelsInSchema<Definition['input']> | ModelsInResponses<Definition['responses']> | ModelsInResponses<Responses>
        : ModelsInJobs<Tree[Key]>;
}[keyof Tree];

/**
 * Every model a contract names, keyed by its `Kizuna.model` title, the same
 * names the OpenAPI document and the Swift and Kotlin clients publish.
 *
 * Each value is the model's output type, what `z.infer` gives.
 *
 * ```ts
 * import type { InferModels } from '@ts-kizuna/core';
 * import { contract } from './contract';
 *
 * export type API = InferModels<typeof contract>;
 *
 * function UserCard({ user }: { user: API['User'] }) {}
 * ```
 */
export type InferModels<Contract_> = Flatten<
    UnionToIntersection<
        | (Contract_ extends {
              routes: infer Routes_ extends Routes;
          }
              ? ModelsInRoutes<Routes_>
              : never)
        | (Contract_ extends {
              jobs?: infer Jobs_ extends Jobs;
          }
              ? ModelsInJobs<Jobs_>
              : never)
    >
>;
