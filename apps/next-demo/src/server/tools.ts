import { countWords, db, forecastFor, signupsOverDays } from '@ts-kizuna-demo/shared';
import { server } from './server';

export const toolHandlers = server.tools({
    users: {
        countActive: async () => ({
            status: 200,
            body: {
                users: await db.users.count(),
            },
        }),

        search: {
            suggest: async ({ input, throwError }) => {
                const { users } = await db.users.search(input.prefix);
                if (users.length === 0) {
                    throwError({
                        status: 404,
                        body: {
                            detail: `Nobody on this workspace starts with "${input.prefix}".`,
                        },
                    });
                }
                return {
                    status: 200,
                    body: {
                        names: users.map((user) => user.name),
                    },
                };
            },
        },

        records: {
            activity: {
                summarize: ({ input }) => ({
                    status: 200,
                    body: {
                        summary: `User ${input.userId} signed in and updated their profile through ${input.year}.`,
                    },
                }),
            },
        },
    },

    weather: {
        getForecast: ({ input, throwError }) => {
            if (input.city.trim() === '') {
                throwError({
                    status: 422,
                    body: {
                        detail: 'Name a city to look the forecast up for.',
                    },
                });
            }
            return {
                status: 200,
                body: forecastFor(input.city, input.unit),
            };
        },
    },

    charts: {
        plotSignups: ({ input }) => ({
            status: 200,
            body: {
                points: signupsOverDays(input.days),
            },
        }),
    },

    countWords: ({ input }) => ({
        status: 200,
        body: {
            words: countWords(input.text),
        },
    }),
});
