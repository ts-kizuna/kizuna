'use client';

import { useRef, useState } from 'react';
import type { z } from 'zod';
import { apiClient } from '../lib/api-client';
import type { ChatStream, ChatMessageSchema } from '../lib/contract';

type ChatEvent = z.infer<typeof ChatStream.event>;
type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * What a tool did, assembled from the `tool_call`, `tool_result` and `tool_error`
 * events. A tool declared `expose: 'name-only'` sends the same events without the
 * payloads, which is why `input` and `output` are optional here.
 */
interface ToolActivity {
    id: string;
    name: string;
    input?: unknown;
    output?: unknown;
    error?: string;
}

interface Turn {
    question: string;
    reasoning: string;
    reply: string;
    tools: ToolActivity[];
    usage?: {
        finishReason: string;
        inputTokens: number;
        outputTokens: number;
    };
}

const emptyTurn = (question: string): Turn => ({
    question,
    reasoning: '',
    reply: '',
    tools: [],
});

export default function ChatPage() {
    const [question, setQuestion] = useState('Where is order ord_1001, and how much was it?');
    const [turns, setTurns] = useState<Turn[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [problem, setProblem] = useState<string | undefined>();
    const historyRef = useRef<ChatMessage[]>([]);

    const send = async () => {
        if (streaming || question.trim().length === 0) return;
        setStreaming(true);
        setProblem(undefined);

        const asked = question;
        setQuestion('');
        const messages: ChatMessage[] = [...historyRef.current, { role: 'user', content: asked }];
        const index = turns.length;
        setTurns((current) => [...current, emptyTurn(asked)]);

        const update = (change: (turn: Turn) => Turn) => {
            setTurns((current) => current.map((turn, position) => (position === index ? change(turn) : turn)));
        };

        const upsertTool = (activity: ToolActivity) =>
            update((turn) => ({
                ...turn,
                tools: turn.tools.some((candidate) => candidate.id === activity.id)
                    ? turn.tools.map((candidate) => (candidate.id === activity.id ? { ...candidate, ...activity } : candidate))
                    : [...turn.tools, activity],
            }));

        try {
            const result = await apiClient.chat.sendChatMessage({
                body: {
                    messages,
                },
            });

            if (result.status !== 200) {
                setProblem(result.body.detail);
                return;
            }

            let reply = '';
            // Each branch is narrowed from the contract's event union, so the payload
            // of a fully exposed tool is typed without any casting.
            for await (const event of result.stream) {
                switch (event.type) {
                    case 'reasoning':
                        update((turn) => ({ ...turn, reasoning: turn.reasoning + event.text }));
                        break;
                    case 'delta':
                        reply += event.text;
                        update((turn) => ({ ...turn, reply: turn.reply + event.text }));
                        break;
                    case 'tool_call':
                        upsertTool({
                            id: event.id,
                            name: event.name,
                            ...('input' in event ? { input: event.input } : {}),
                        });
                        break;
                    case 'tool_result':
                        upsertTool({
                            id: event.id,
                            name: event.name,
                            ...('output' in event ? { output: event.output } : {}),
                        });
                        break;
                    case 'tool_error':
                        upsertTool({
                            id: event.id,
                            name: event.name,
                            error: event.message,
                        });
                        break;
                    case 'done':
                        update((turn) => ({
                            ...turn,
                            usage: {
                                finishReason: event.finishReason,
                                inputTokens: event.inputTokens,
                                outputTokens: event.outputTokens,
                            },
                        }));
                        break;
                    case 'aborted':
                        setProblem(event.reason);
                        break;
                    case 'start':
                        break;
                }
            }

            historyRef.current = [...messages, { role: 'assistant', content: reply }];
        } catch (error) {
            setProblem(error instanceof Error ? error.message : 'The stream failed.');
        } finally {
            setStreaming(false);
        }
    };

    return (
        <main
            style={{
                maxWidth: '46rem',
                margin: '0 auto',
                padding: '2rem 1rem 4rem',
            }}>
            <h1
                style={{
                    fontSize: '1.35rem',
                    marginBottom: '0.25rem',
                }}>
                ts-kizuna AI demo
            </h1>
            <p
                style={{
                    color: '#8b93a7',
                    marginTop: 0,
                    lineHeight: 1.5,
                }}>
                One <code>POST /chat</code> route streaming a typed event union. <code>lookup_order</code> is exposed in full;{' '}
                <code>search_orders</code> is name-only, so its arguments never reach the browser.
            </p>

            {turns.map((turn, position) => (
                <section
                    key={position}
                    style={{
                        marginTop: '1.75rem',
                    }}>
                    <p
                        style={{
                            fontWeight: 600,
                            margin: '0 0 0.75rem',
                        }}>
                        {turn.question}
                    </p>

                    {turn.reasoning.length > 0 && (
                        <details
                            style={{
                                marginBottom: '0.75rem',
                                color: '#8b93a7',
                            }}>
                            <summary>reasoning</summary>
                            <p
                                style={{
                                    whiteSpace: 'pre-wrap',
                                    fontSize: '0.85rem',
                                }}>
                                {turn.reasoning}
                            </p>
                        </details>
                    )}

                    {turn.tools.map((activity) => (
                        <div
                            key={activity.id}
                            style={{
                                border: '1px solid #262b36',
                                borderRadius: '0.5rem',
                                padding: '0.65rem 0.8rem',
                                marginBottom: '0.6rem',
                                background: '#151924',
                                fontSize: '0.85rem',
                            }}>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: '0.5rem',
                                }}>
                                <strong>{activity.name}</strong>
                                <span
                                    style={{
                                        color: activity.error ? '#f2777a' : activity.output === undefined ? '#d5a45c' : '#7fb37f',
                                    }}>
                                    {activity.error ? 'failed' : activity.output === undefined ? 'running' : 'done'}
                                </span>
                            </div>
                            {activity.input !== undefined && (
                                <pre
                                    style={{
                                        margin: '0.4rem 0 0',
                                        color: '#8b93a7',
                                        overflowX: 'auto',
                                    }}>
                                    {JSON.stringify(activity.input)}
                                </pre>
                            )}
                            {activity.output !== undefined && (
                                <pre
                                    style={{
                                        margin: '0.4rem 0 0',
                                        overflowX: 'auto',
                                    }}>
                                    {JSON.stringify(activity.output, null, 2)}
                                </pre>
                            )}
                            {activity.error && (
                                <p
                                    style={{
                                        margin: '0.4rem 0 0',
                                        color: '#f2777a',
                                    }}>
                                    {activity.error}
                                </p>
                            )}
                        </div>
                    ))}

                    <p
                        style={{
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.6,
                            margin: 0,
                        }}>
                        {turn.reply}
                    </p>

                    {turn.usage && (
                        <p
                            style={{
                                color: '#8b93a7',
                                fontSize: '0.8rem',
                                marginTop: '0.5rem',
                            }}>
                            {turn.usage.finishReason} · {turn.usage.inputTokens} in / {turn.usage.outputTokens} out
                        </p>
                    )}
                </section>
            ))}

            {problem && (
                <p
                    style={{
                        color: '#f2777a',
                        marginTop: '1.5rem',
                    }}>
                    {problem}
                </p>
            )}

            <form
                onSubmit={(submitEvent) => {
                    submitEvent.preventDefault();
                    void send();
                }}
                style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginTop: '2rem',
                }}>
                <input
                    value={question}
                    onChange={(changeEvent) => setQuestion(changeEvent.target.value)}
                    placeholder="Ask about an order"
                    style={{
                        flex: 1,
                        padding: '0.6rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #262b36',
                        background: '#151924',
                        color: 'inherit',
                    }}
                />
                <button
                    type="submit"
                    disabled={streaming}
                    style={{
                        padding: '0.6rem 1rem',
                        borderRadius: '0.5rem',
                        border: 'none',
                        background: streaming ? '#262b36' : '#4c7fd4',
                        color: '#fff',
                        cursor: streaming ? 'default' : 'pointer',
                    }}>
                    {streaming ? 'streaming' : 'send'}
                </button>
            </form>
        </main>
    );
}
