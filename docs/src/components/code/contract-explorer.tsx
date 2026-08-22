import clsx from 'clsx';
import type { ReactNode } from 'react';
import { FileText, Globe, Server, ShieldCheck, TriangleAlert } from 'lucide-react';
import { CodeWindow } from './code-window';
import { KotlinLogo, McpLogo, SwiftLogo, TanstackLogo, TsLogo } from './brand-icons';
import styles from './contract-explorer.module.css';

const icons = {
    server: <Server className={styles.icon} />,
    file: <FileText className={styles.icon} />,
    alert: <TriangleAlert className={styles.icon} />,
    globe: <Globe className={styles.icon} />,
    shield: <ShieldCheck className={styles.icon} />,
};

const brandIcons = {
    typescript: <TsLogo key="ts" className={styles.brandIcon} />,
    swift: <SwiftLogo key="swift" className={styles.brandIcon} />,
    kotlin: <KotlinLogo key="kotlin" className={styles.brandIcon} />,
};

const methodStyles = {
    GET: styles.methodGet,
    POST: styles.methodPost,
    PUT: styles.methodWrite,
    PATCH: styles.methodWrite,
    DELETE: styles.methodDelete,
};

function Method({ name }: { name: keyof typeof methodStyles }) {
    return <span className={clsx(styles.method, methodStyles[name])}>{name}</span>;
}

interface OutputNode {
    icon: ReactNode;
    label: string;
    desc: string;
    file: string;
    fileIcon?: ReactNode;
    lang: string;
    code: string;
}

const NODES: OutputNode[] = [
    {
        icon: icons.server,
        label: 'Server',
        desc: 'Validated inputs, type-checked responses',
        file: 'router.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `server.router({
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
});`,
    },
    {
        icon: icons.file,
        label: 'OpenAPI',
        desc: 'Generated from the contract',
        file: 'openapi.yaml',
        lang: 'yaml',
        code: `/users/{id}:
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
              $ref: '#/components/schemas/User'
      '404':
        content:
          application/problem+json:
            schema:
              $ref: '#/components/schemas/ProblemDetails'`,
    },
    {
        icon: icons.globe,
        label: 'REST',
        desc: 'Every route is a real REST endpoint',
        file: 'localhost:3000/users/1',
        fileIcon: <Method name="GET" />,
        lang: 'http',
        code: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "1",
  "name": "Ada"
}

HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "about:blank",
  "status": 404,
  "detail": "Not found"
}`,
    },
    {
        icon: <TsLogo className={styles.icon} />,
        label: 'TypeScript client',
        desc: 'Call your API like a function',
        file: 'api-client.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `const apiClient = new KizunaClient(contract, {
  baseUrl: 'http://localhost:3000',
});

const res = await apiClient.users.getUser({
  params: {
    id: '1',
  },
});

if (res.status === 200) {
  res.body; // User, fully typed
} else {
  throw new Error(res.body.detail);
}`,
    },
    {
        icon: <TanstackLogo className={styles.icon} />,
        label: 'TanStack Query client',
        desc: 'Query and mutation options, keys included',
        file: 'user-list.tsx',
        fileIcon: brandIcons.typescript,
        lang: 'tsx',
        code: `const api = new KizunaTanstackQuery(contract, apiClient);

const { data } = useQuery(
  api.users.getUser.queryOptions({
    input: {
      params: {
        id: '1',
      },
    },
  })
);

// invalidate every users query
queryClient.invalidateQueries({
  queryKey: api.users.key(),
});`,
    },
    {
        icon: <SwiftLogo className={styles.icon} />,
        label: 'Swift client',
        desc: 'A native client for iOS and macOS',
        file: 'UserService.swift',
        fileIcon: brandIcons.swift,
        lang: 'swift',
        code: `let client = APIClient(
  baseURL: URL(string: "http://localhost:3000")!
)

do {
  let res = try await client.users.getUser(
    .params(
      id: "1"
    )
  )
  res.body // User, Codable
} catch {
  error // typed failure (e.g. .notFound)
}`,
    },
    {
        icon: <KotlinLogo className={styles.icon} />,
        label: 'Kotlin client',
        desc: 'A native client for Android and the JVM',
        file: 'APIClient.kt',
        fileIcon: brandIcons.kotlin,
        lang: 'kotlin',
        code: `val client = APIClient(
  baseUrl = "http://localhost:3000"
)

try {
  val res = client.users.getUser {
    params(
      id = "1"
    )
  }
  res.body // User, @Serializable
} catch (error: APIClient.UsersGetUser.Failure.NotFound) {
  error.body.detail // typed failure
}`,
    },
    {
        icon: <McpLogo className={styles.icon} />,
        label: 'MCP server',
        desc: 'Your routes as tools for AI agents',
        file: 'k.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `plugins: {
  mcp: mcpPlugin()
}

// each route → a typed MCP tool:
// GET → read-only · DELETE → destructive
// PUT → idempotent`,
    },
    {
        icon: icons.shield,
        label: 'Built-in validation',
        desc: 'Every request checked against the contract',
        file: 'localhost:3000/users',
        fileIcon: <Method name="POST" />,
        lang: 'http',
        code: `{
  "name": "Ada",
  "email": "nope"
}

HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "status": 400,
  "errors": [
    { "code": "invalid_string_format",
      "path": ["email"],
      "message": "Invalid email" }
  ]
}`,
    },
    {
        icon: icons.alert,
        label: 'Deprecation',
        desc: 'Mark once, it propagates everywhere',
        file: 'routes.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `deleteUser: {
    deprecated: true,
    ...
}
// → OpenAPI deprecated: true
// → Swift @available
// → Kotlin @Deprecated`,
    },
];

const CONTRACT_CODE = `export const k = new Kizuna();

const UserSchema = Kizuna.model({ // shows up as a named User in OpenAPI, Swift, and Kotlin
  title: 'User',
  schema: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

const users = k.routes({
  getUser: {
    method: 'GET',
    path: '/users/:id',
    responses: {
      200: UserSchema,
      404: ProblemDetailsSchema, // or ProblemDetailsSchema.extend({ ... }) to add extra fields
    },
  },
});

export const contract = k.contract({
  routes: {
    users,
  },
});`;

export function ContractExplorer({ className }: { className?: string }) {
    return (
        <div className={clsx(styles.root, className)}>
            <div className={styles.card}>
                <CodeWindow lang="ts" code={CONTRACT_CODE} title="contract.ts" icon={brandIcons.typescript} dots />
            </div>
            <div className={styles.connector}>
                <svg
                    className={styles.connectorIcon}
                    viewBox="0 0 24 48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden>
                    <path d="M12 3v38" />
                    <path d="m2 32 10 9 10-9" />
                </svg>
            </div>
            <div className={styles.grid}>
                {NODES.map((node) => (
                    <div key={node.label} className={styles.card}>
                        <div className={styles.cardHead}>
                            <span className={styles.chip}>{node.icon}</span>
                            <div>
                                <div className={styles.nodeLabel}>{node.label}</div>
                                <div className={styles.nodeDesc}>{node.desc}</div>
                            </div>
                        </div>
                        <CodeWindow lang={node.lang} code={node.code} title={node.file} icon={node.fileIcon} dots />
                    </div>
                ))}
            </div>
        </div>
    );
}
