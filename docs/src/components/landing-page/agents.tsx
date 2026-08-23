import clsx from 'clsx';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ClaudeWindow } from '@/components/code/claude-window';
import ChatGPTLogo from '@/icons/ChatGPT.svg';
import ClaudeLogo from '@/icons/Claude.svg';
import CursorLogo from '@/icons/Cursor.svg';
import McpLogo from '@/icons/Mcp.svg';
import styles from './agents.module.css';

interface Tool {
    method: 'GET' | 'POST' | 'DELETE';
    name: string;
}

const tools: Tool[] = [
    {
        method: 'GET',
        name: 'users_list_users',
    },
    {
        method: 'GET',
        name: 'users_get_user',
    },
    {
        method: 'POST',
        name: 'users_create_user',
    },
    {
        method: 'DELETE',
        name: 'users_delete_user',
    },
];

const methodStyles = {
    GET: styles.methodGet,
    POST: styles.methodPost,
    DELETE: styles.methodDelete,
};

export function Agents() {
    return (
        <section className={styles.root}>
            <div className={styles.head}>
                <h2 className={styles.title}>Built for AI agents</h2>
                <p className={styles.subtitle}>Serve your API to AI assistants from the contract you already wrote.</p>
            </div>

            <div className={styles.panels}>
                <article className={styles.panel}>
                    <div className={styles.visual}>
                        <div className={styles.diagram}>
                            <div className={styles.agents}>
                                <span className={styles.agent}>
                                    <ClaudeLogo className={styles.agentIcon} aria-hidden />
                                    Claude
                                </span>
                                <span className={styles.agent}>
                                    <CursorLogo className={styles.agentIcon} aria-hidden />
                                    Cursor
                                </span>
                                <span className={styles.agent}>
                                    <ChatGPTLogo className={styles.agentIcon} aria-hidden />
                                    ChatGPT
                                </span>
                            </div>
                            <span className={styles.wire} aria-hidden />
                            <div className={styles.server}>
                                <McpLogo className={styles.serverIcon} aria-hidden />
                                <span className={styles.serverName}>Your API</span>
                                <span className={styles.serverRole}>MCP server</span>
                            </div>
                            <span className={styles.wire} aria-hidden />
                            <div className={styles.tools}>
                                <p className={styles.toolGroup}>users</p>
                                {tools.map((tool) => (
                                    <p key={tool.name} className={styles.tool}>
                                        <span className={clsx(styles.method, methodStyles[tool.method])}>{tool.method}</span>
                                        {tool.name}
                                    </p>
                                ))}
                            </div>
                        </div>
                    </div>
                    <Link href="/docs/mcp" className={styles.panelTitle}>
                        MCP server
                        <ArrowRight className={styles.panelArrow} aria-hidden />
                    </Link>
                    <p className={styles.panelText}>
                        Install the MCP plugin and every route becomes a typed tool that AI assistants can discover and call.
                    </p>
                </article>

                <article className={styles.panel}>
                    <div className={styles.visual}>
                        <div className={styles.claudeFrame}>
                            <ClaudeWindow />
                        </div>
                    </div>
                    <Link href="/docs/mcp" className={styles.panelTitle}>
                        Annotated tools
                        <ArrowRight className={styles.panelArrow} aria-hidden />
                    </Link>
                    <p className={styles.panelText}>
                        Each tool carries the annotations of its HTTP method, so an assistant reads freely and asks before it deletes.
                    </p>
                </article>
            </div>
        </section>
    );
}
