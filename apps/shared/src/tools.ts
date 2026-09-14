import { z } from 'zod';
import { k } from './k';
import { usersRoutes } from './routes/users';
import { workspaceRoutes } from './routes/workspace';

const TemperatureUnit = z.enum(['celsius', 'fahrenheit']);

/**
 * The tools the assistant may call while it streams a reply. They are also
 * offered over MCP, so the same declaration serves both.
 */
export const tools = k.tools(({ toolFromRoutes }) => ({
    users: {
        find: toolFromRoutes(usersRoutes.getUser),
        list: toolFromRoutes(usersRoutes.listUsers),
        create: toolFromRoutes(usersRoutes.createUser),
        remove: toolFromRoutes(usersRoutes.deleteUser),
        archive: toolFromRoutes(usersRoutes.archiveUser, {
            description: 'Archive a user. Their data stays, and they stop appearing in lists.',
        }),
        countActive: {
            description: 'Count how many users are on the workspace right now',
            output: z.object({
                users: z.int(),
            }),
            annotations: {
                readOnlyHint: true,
            },
        },
        search: {
            byName: toolFromRoutes(usersRoutes.searchUsers),
            suggest: {
                description: 'Suggest names that start with a prefix, before the caller commits to a search',
                input: z.object({
                    prefix: z.string().min(1),
                }),
                output: z.object({
                    names: z.array(z.string()),
                }),
                failures: [404],
                annotations: {
                    readOnlyHint: true,
                },
            },
        },
        records: {
            profile: toolFromRoutes(usersRoutes.userProfile),
            activity: {
                forYear: toolFromRoutes(usersRoutes.userActivity),
                summarize: {
                    description: 'Say in one sentence what a user did over a year',
                    input: z.object({
                        userId: z.string(),
                        year: z.int(),
                    }),
                    output: z.object({
                        summary: z.string(),
                    }),
                    annotations: {
                        readOnlyHint: true,
                    },
                },
            },
        },
    },
    workspace: {
        read: toolFromRoutes(workspaceRoutes.info.getWorkspace),
    },
    weather: {
        getForecast: {
            title: 'Weather forecast',
            description: 'Look up tomorrow forecast for one city',
            input: z.object({
                city: z.string().min(1),
                unit: TemperatureUnit.default('celsius'),
            }),
            output: z.object({
                temperature: z.number(),
                unit: TemperatureUnit,
                summary: z.string(),
            }),
            annotations: {
                readOnlyHint: true,
            },
        },
    },
    charts: {
        plotSignups: {
            title: 'Signup chart',
            description: 'Plot signups per day over the last N days, for the client to draw as a chart',
            input: z.object({
                days: z.int().min(1).max(90),
            }),
            output: z.object({
                points: z.array(
                    z.object({
                        date: z.string(),
                        signups: z.int(),
                    })
                ),
            }),
            annotations: {
                readOnlyHint: true,
            },
        },
    },
    countWords: {
        description: 'Count the words in a piece of text',
        input: z.object({
            text: z.string(),
        }),
        output: z.object({
            words: z.int(),
        }),
        annotations: {
            readOnlyHint: true,
        },
    },
}));
