import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { deprecationHeaders } from './deprecation.js';
import type { RouteDefinition } from './types.js';

const route = (overrides: Partial<RouteDefinition>): RouteDefinition => ({
    method: 'DELETE',
    path: '/users/:id',
    responses: {
        200: z.object({
            success: z.boolean(),
        }),
    },
    ...overrides,
});

describe('deprecationHeaders', () => {
    test('a route with neither deprecation nor sunset announces nothing', () => {
        expect(deprecationHeaders(route({}))).toEqual({});
    });

    test('deprecated: true announces nothing', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: true,
                })
            )
        ).toEqual({});
    });

    test('a deprecation message alone announces nothing', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: 'use archiveUser instead',
                })
            )
        ).toEqual({});
    });

    test('a deprecation date becomes a Deprecation header with Unix seconds', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: {
                        date: '2026-03-01T00:00:00Z',
                    },
                })
            )
        ).toEqual({
            deprecation: '@1772323200',
        });
    });

    test('a deprecation link rides in a Link header with the deprecation relation', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: {
                        date: '2026-03-01T00:00:00Z',
                        link: 'https://example.com/changelog/delete-user',
                    },
                })
            )
        ).toEqual({
            deprecation: '@1772323200',
            link: '<https://example.com/changelog/delete-user>; rel="deprecation"',
        });
    });

    test('a sunset timestamp becomes a Sunset header with an HTTP date', () => {
        expect(
            deprecationHeaders(
                route({
                    sunset: '2027-01-01T00:00:00Z',
                })
            )
        ).toEqual({
            sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
        });
    });

    test('a sunset link rides in a Link header with the sunset relation', () => {
        expect(
            deprecationHeaders(
                route({
                    sunset: {
                        date: '2027-01-01T00:00:00Z',
                        link: 'https://example.com/retirement-policy',
                    },
                })
            )
        ).toEqual({
            sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
            link: '<https://example.com/retirement-policy>; rel="sunset"',
        });
    });

    test('deprecation and sunset links share one Link header', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: {
                        date: '2026-03-01T00:00:00Z',
                        link: 'https://example.com/changelog/delete-user',
                    },
                    sunset: {
                        date: '2027-01-01T00:00:00Z',
                        link: 'https://example.com/retirement-policy',
                    },
                })
            )
        ).toEqual({
            deprecation: '@1772323200',
            sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
            link: '<https://example.com/changelog/delete-user>; rel="deprecation", <https://example.com/retirement-policy>; rel="sunset"',
        });
    });

    test('a date alone means midnight UTC', () => {
        expect(
            deprecationHeaders(
                route({
                    deprecated: {
                        date: '2026-03-01',
                    },
                    sunset: '2027-01-01',
                })
            )
        ).toEqual({
            deprecation: '@1772323200',
            sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
        });
    });

    test('a sunset offset renders in UTC', () => {
        expect(
            deprecationHeaders(
                route({
                    sunset: '2027-01-01T02:00:00+02:00',
                })
            )
        ).toEqual({
            sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
        });
    });
});

describe('k.contract date validation', () => {
    const contractWith = (overrides: Partial<RouteDefinition>) => {
        const k = new Kizuna();
        return () =>
            k.contract({
                routes: {
                    users: {
                        deleteUser: route(overrides),
                    },
                },
            });
    };

    test('accepts ISO 8601 timestamps', () => {
        expect(
            contractWith({
                deprecated: {
                    date: '2026-03-01T00:00:00Z',
                },
                sunset: '2027-01-01T00:00:00.500+01:00',
            })
        ).not.toThrow();
    });

    test('accepts ISO 8601 dates alone', () => {
        expect(
            contractWith({
                deprecated: {
                    date: '2026-03-01',
                },
                sunset: '2027-01-01',
            })
        ).not.toThrow();
    });

    test('rejects a sunset that is not ISO 8601', () => {
        expect(
            contractWith({
                sunset: '01/01/2027',
            })
        ).toThrow("Route 'users.deleteUser' declares a sunset of '01/01/2027', which is not an ISO 8601 date or timestamp.");
    });

    test('rejects a sunset object with an invalid date', () => {
        expect(
            contractWith({
                sunset: {
                    date: 'next spring',
                },
            })
        ).toThrow(/not an ISO 8601 date or timestamp/);
    });

    test('rejects a deprecated.date that is not ISO 8601', () => {
        expect(
            contractWith({
                deprecated: {
                    date: '01/03/2026',
                },
            })
        ).toThrow("Route 'users.deleteUser' declares deprecated.date '01/03/2026', which is not an ISO 8601 date or timestamp.");
    });

    test('rejects a well-formed timestamp naming an impossible date', () => {
        expect(
            contractWith({
                sunset: '2027-13-01T00:00:00Z',
            })
        ).toThrow(/not an ISO 8601 date or timestamp/);
    });

    test('rejects a day the calendar does not have', () => {
        expect(
            contractWith({
                sunset: '2026-02-30',
            })
        ).toThrow(/not an ISO 8601 date or timestamp/);
    });

    test('rejects a date with a time but no offset', () => {
        expect(
            contractWith({
                sunset: '2027-01-01T00:00:00',
            })
        ).toThrow(/not an ISO 8601 date or timestamp/);
    });
});
