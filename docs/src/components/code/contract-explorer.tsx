import clsx from 'clsx';
import { FileText, Globe, Server } from 'lucide-react';
import { ScrollRail } from '@/components/landing-page/scroll-rail';
import type { ScrollRailItem } from '@/components/landing-page/scroll-rail';
import { CodeWindow } from './code-window';
import { KotlinLogo, McpLogo, SwiftLogo, TsLogo } from './brand-icons';
import styles from './contract-explorer.module.css';

const brandIcons = {
    typescript: <TsLogo key="ts" className={styles.brandIcon} />,
    swift: <SwiftLogo key="swift" className={styles.brandIcon} />,
    kotlin: <KotlinLogo key="kotlin" className={styles.brandIcon} />,
};

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

const SURFACES: ScrollRailItem[] = [
    {
        id: 'server',
        icon: <Server />,
        label: 'Server',
        title: 'Handlers that already know the shape',
        description:
            'Params, query, body, and headers arrive validated and typed. Responses are checked against the statuses the contract declares.',
        visual: (
            <CodeWindow
                lang="ts"
                title="router.ts"
                icon={brandIcons.typescript}
                dots
                code={`server.router({
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
});`}
            />
        ),
    },
    {
        id: 'rest',
        icon: <Globe />,
        label: 'REST',
        title: 'A real HTTP API underneath',
        description:
            'Every route is a plain endpoint anything can call. Failures come back as Problem Details, the format RFC 9457 describes.',
        visual: (
            <CodeWindow
                lang="http"
                title="localhost:3000/users/1"
                dots
                code={`HTTP/1.1 200 OK
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
}`}
            />
        ),
    },
    {
        id: 'openapi',
        icon: <FileText />,
        label: 'OpenAPI',
        title: 'A spec you never hand-write',
        description: 'The generator reads the contract. No annotations to sprinkle, no second document to keep in sync.',
        visual: (
            <CodeWindow
                lang="yaml"
                title="openapi.yaml"
                dots
                code={`/users/{id}:
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
              $ref: '#/components/schemas/ProblemDetails'`}
            />
        ),
    },
    {
        id: 'ts-client',
        icon: <TsLogo />,
        label: 'TypeScript client',
        title: 'Call your API like a function',
        description: 'The client reads the same contract, so the response narrows to one body per status code.',
        visual: (
            <CodeWindow
                lang="ts"
                title="api-client.ts"
                icon={brandIcons.typescript}
                dots
                code={`const client = new KizunaClient(contract, {
  baseUrl: 'http://localhost:3000',
});

const res = await client.users.getUser({
  params: {
    id: '1',
  },
});

if (res.status === 200) {
  res.body; // User, fully typed
} else {
  throw new Error(res.body.detail);
}`}
            />
        ),
    },
    {
        id: 'swift-client',
        icon: <SwiftLogo />,
        label: 'Swift client',
        title: 'A native client for iOS and macOS',
        description: 'Generated Codable models and typed failures, ready to drop into an Xcode project.',
        visual: (
            <CodeWindow
                lang="swift"
                title="UserService.swift"
                icon={brandIcons.swift}
                dots
                code={`let client = APIClient(
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
}`}
            />
        ),
    },
    {
        id: 'kotlin-client',
        icon: <KotlinLogo />,
        label: 'Kotlin client',
        title: 'A native client for Android and the JVM',
        description: 'Generated @Serializable models, and a failure type per error status the contract declares.',
        visual: (
            <CodeWindow
                lang="kotlin"
                title="APIClient.kt"
                icon={brandIcons.kotlin}
                dots
                code={`val client = APIClient(
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
}`}
            />
        ),
    },
    {
        id: 'mcp',
        icon: <McpLogo />,
        label: 'MCP server',
        title: 'Your routes as tools for AI agents',
        description: 'Install the plugin and every route becomes a typed MCP tool, with the safety hints its method implies.',
        visual: (
            <CodeWindow
                lang="ts"
                title="k.ts"
                icon={brandIcons.typescript}
                dots
                code={`plugins: {
  mcp: mcpPlugin()
}

// each route → a typed MCP tool:
// GET → read-only · DELETE → destructive
// PUT → idempotent`}
            />
        ),
    },
];

export function ContractSource({ className }: { className?: string }) {
    return (
        <div className={clsx(styles.source, className)}>
            <CodeWindow lang="ts" code={CONTRACT_CODE} title="contract.ts" icon={brandIcons.typescript} dots />
        </div>
    );
}

export function ContractSurfaces({ className }: { className?: string }) {
    return (
        <div className={clsx(styles.surfaces, className)}>
            <ScrollRail items={SURFACES} />
        </div>
    );
}
