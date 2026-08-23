import Link from 'next/link';
import { ArrowRight, Clock, KeyRound, Puzzle, Waypoints } from 'lucide-react';
import { CodeWindow } from '@/components/code/code-window';
import KotlinLogo from '@/icons/Kotlin.svg';
import SwiftLogo from '@/icons/Swift.svg';
import TanstackLogo from '@/icons/TanStack.svg';
import TsLogo from '@/icons/TypeScript.svg';
import styles from './contract.module.css';
import type { ComponentType } from 'react';

interface Declaration {
    icon: ComponentType<{ className?: string }>;
    label: string;
}

const declarations: Declaration[] = [
    {
        icon: Waypoints,
        label: 'Routes',
    },
    {
        icon: KeyRound,
        label: 'Auth',
    },
    {
        icon: Clock,
        label: 'Jobs',
    },
    {
        icon: Puzzle,
        label: 'Plugins',
    },
];

const CONTRACT_CODE = `export const contract = k.contract({
  routes: { users, events },
});`;

const SERVER_CODE = `server.router({
  users: {
    getUser: async ({ params, throwError }) => {
      const user = await db.users.findById(params.id);

      if (!user) throwError({
        status: 404,
        body: {
          detail: 'Not found',
        },
      });

      return {
        status: 200,
        body: user,
      };
    },
  },
});`;

const CLIENT_CODE = `const res = await apiClient.users.getUser({
  params: {
    id: '1',
  },
});

if (res.status === 200) {
  res.body; // User, fully typed
} else {
  throw new Error(res.body.detail);
}`;

const OPENAPI_CODE = `/users/{id}:
  get:
    operationId: getUser
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    responses:
      '200':
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/User'`;

const tsIcon = <TsLogo className={styles.fileIcon} />;

export function Contract() {
    return (
        <section className={styles.root}>
            <div className={styles.head}>
                <h2 className={styles.title}>
                    One contract. <br />
                    Everything reads from it.
                </h2>
                <p className={styles.subtitle}>
                    Write it in TypeScript with Zod. The server, the clients, and the OpenAPI spec follow, typed end to end.
                </p>
            </div>

            <div className={styles.chips}>
                {declarations.map((declaration) => (
                    <span key={declaration.label} className={styles.chipCell}>
                        <span className={styles.chip}>
                            <declaration.icon className={styles.chipIcon} aria-hidden />
                            {declaration.label}
                        </span>
                    </span>
                ))}
            </div>

            <div className={styles.joinIn} aria-hidden />

            <div className={styles.terminal}>
                <div className={styles.terminalBar}>
                    <span className={styles.terminalDots}>
                        <span className={styles.terminalDot} />
                        <span className={styles.terminalDot} />
                        <span className={styles.terminalDot} />
                    </span>
                    <span className={styles.terminalTitle}>contract.ts</span>
                </div>
                <pre className={styles.terminalCode}>{CONTRACT_CODE}</pre>
            </div>

            <div className={styles.joinOut} aria-hidden>
                <span className={styles.joinOutDrop} />
                <span className={styles.joinOutRail} />
                <span className={styles.joinOutStub} />
                <span className={styles.joinOutStub} />
                <span className={styles.joinOutStub} />
                <span className={styles.joinOutDot} />
                <span className={styles.joinOutDot} />
                <span className={styles.joinOutDot} />
            </div>

            <div className={styles.columns}>
                <article className={styles.column}>
                    <Link href="/docs/building/router" className={styles.columnTitle}>
                        Server
                        <ArrowRight className={styles.columnArrow} aria-hidden />
                    </Link>
                    <p className={styles.columnText}>Handlers with validated inputs and type-checked responses.</p>
                    <div className={styles.visual}>
                        <div className={styles.frame}>
                            <CodeWindow lang="ts" code={SERVER_CODE} title="router.ts" icon={tsIcon} dots />
                        </div>
                    </div>
                </article>

                <article className={styles.column}>
                    <Link href="/docs/clients/fetch" className={styles.columnTitle}>
                        Clients
                        <ArrowRight className={styles.columnArrow} aria-hidden />
                    </Link>
                    <p className={styles.columnText}>Typed fetch and TanStack Query, plus generated Swift and Kotlin.</p>
                    <div className={styles.visual}>
                        <div className={styles.strip}>
                            <span className={styles.stripItemActive}>
                                <TsLogo className={styles.stripIcon} />
                            </span>
                            <span className={styles.stripItem}>
                                <TanstackLogo className={styles.stripIcon} />
                            </span>
                            <span className={styles.stripItem}>
                                <SwiftLogo className={styles.stripIcon} />
                            </span>
                            <span className={styles.stripItem}>
                                <KotlinLogo className={styles.stripIcon} />
                            </span>
                        </div>
                        <div className={styles.frame}>
                            <CodeWindow lang="ts" code={CLIENT_CODE} title="api-client.ts" icon={tsIcon} dots />
                        </div>
                    </div>
                </article>

                <article className={styles.column}>
                    <Link href="/docs/openapi" className={styles.columnTitle}>
                        OpenAPI
                        <ArrowRight className={styles.columnArrow} aria-hidden />
                    </Link>
                    <p className={styles.columnText}>A complete spec generated from the contract, no annotations needed.</p>
                    <div className={styles.visual}>
                        <div className={styles.frame}>
                            <CodeWindow lang="yaml" code={OPENAPI_CODE} title="openapi.yaml" dots />
                        </div>
                    </div>
                </article>
            </div>
        </section>
    );
}
