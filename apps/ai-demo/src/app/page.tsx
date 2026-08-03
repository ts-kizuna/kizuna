'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { createAgentTransport } from '@ts-kizuna/ai/ui';
import { apiClient } from '../lib/api-client';

/**
 * The route speaks kizuna's typed event union, which is what the OpenAPI document
 * and the Swift and Kotlin clients read. The adapter converts that union to the
 * chunks `useChat` expects, so nothing here hand-rolls streaming state.
 */
const transport = createAgentTransport({
    call: async ({ messages, abortSignal }) => {
        const result = await apiClient.chat.sendChatMessage({
            body: {
                messages,
            },
            fetchOptions: {
                signal: abortSignal,
            },
        });
        return result.status === 200 ? result : { error: result.body.detail };
    },
});

const card = {
    border: '1px solid #262b36',
    borderRadius: '0.5rem',
    padding: '0.65rem 0.8rem',
    margin: '0.6rem 0',
    background: '#151924',
    fontSize: '0.85rem',
} as const;

export default function ChatPage() {
    const { messages, sendMessage, status, error } = useChat({ transport });
    const [question, setQuestion] = useState('Where is order ord_1001, and how much was it?');
    const busy = status === 'submitted' || status === 'streaming';

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
                One contract-typed <code>POST /chat</code> route, driven by <code>useChat</code>. <code>lookup_order</code> is exposed in
                full; <code>search_orders</code> is name-only, so its arguments never reach the browser.
            </p>

            {messages.map((message) => (
                <section
                    key={message.id}
                    style={{
                        marginTop: '1.5rem',
                    }}>
                    <p
                        style={{
                            color: '#8b93a7',
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            margin: '0 0 0.35rem',
                        }}>
                        {message.role}
                    </p>
                    {message.parts.map((part, index) => {
                        if (part.type === 'text') {
                            return (
                                <p
                                    key={index}
                                    style={{
                                        whiteSpace: 'pre-wrap',
                                        lineHeight: 1.6,
                                        margin: 0,
                                    }}>
                                    {part.text}
                                </p>
                            );
                        }

                        if (part.type === 'reasoning') {
                            return (
                                <details
                                    key={index}
                                    style={{
                                        color: '#8b93a7',
                                        marginBottom: '0.5rem',
                                    }}>
                                    <summary>reasoning</summary>
                                    <p
                                        style={{
                                            whiteSpace: 'pre-wrap',
                                            fontSize: '0.85rem',
                                        }}>
                                        {part.text}
                                    </p>
                                </details>
                            );
                        }

                        // Tool parts arrive as `tool-<name>`, carrying whatever the route's
                        // exposure setting allowed onto the wire.
                        if (part.type.startsWith('tool-')) {
                            const tool = part as {
                                type: string;
                                state?: string;
                                input?: unknown;
                                output?: unknown;
                                errorText?: string;
                            };
                            return (
                                <div key={index} style={card}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            gap: '0.5rem',
                                        }}>
                                        <strong>{tool.type.slice('tool-'.length)}</strong>
                                        <span
                                            style={{
                                                color: tool.errorText ? '#f2777a' : tool.output === undefined ? '#d5a45c' : '#7fb37f',
                                            }}>
                                            {tool.errorText ?? tool.state ?? 'running'}
                                        </span>
                                    </div>
                                    {tool.input !== undefined && (
                                        <pre
                                            style={{
                                                margin: '0.4rem 0 0',
                                                color: '#8b93a7',
                                                overflowX: 'auto',
                                            }}>
                                            {JSON.stringify(tool.input)}
                                        </pre>
                                    )}
                                    {tool.output !== undefined && (
                                        <pre
                                            style={{
                                                margin: '0.4rem 0 0',
                                                overflowX: 'auto',
                                            }}>
                                            {JSON.stringify(tool.output, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            );
                        }

                        return null;
                    })}
                </section>
            ))}

            {error && (
                <p
                    style={{
                        color: '#f2777a',
                        marginTop: '1.5rem',
                    }}>
                    {error.message}
                </p>
            )}

            <form
                onSubmit={(submitEvent) => {
                    submitEvent.preventDefault();
                    if (busy || question.trim().length === 0) return;
                    void sendMessage({ text: question });
                    setQuestion('');
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
                    disabled={busy}
                    style={{
                        padding: '0.6rem 1rem',
                        borderRadius: '0.5rem',
                        border: 'none',
                        background: busy ? '#262b36' : '#4c7fd4',
                        color: '#fff',
                        cursor: busy ? 'default' : 'pointer',
                    }}>
                    {busy ? 'streaming' : 'send'}
                </button>
            </form>
        </main>
    );
}
