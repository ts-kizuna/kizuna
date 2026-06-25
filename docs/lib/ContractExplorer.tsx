import type { ReactNode } from 'react';
import { BotMessageSquare, Code, FileText, Server, Smartphone, TriangleAlert } from 'lucide-react';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

const icons = {
    server: <Server className="size-4" />,
    code: <Code className="size-4" />,
    phone: <Smartphone className="size-4" />,
    file: <FileText className="size-4" />,
    bot: <BotMessageSquare className="size-4" />,
    alert: <TriangleAlert className="size-4" />,
};

function TsLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="#3178c6" className={className}>
            <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
        </svg>
    );
}

const brandIcons = {
    typescript: <TsLogo className="size-3.5" />,
    swift: (
        <svg viewBox="0 0 24 24" fill="#f05138" className="size-3.5">
            <path d="M7.508 0c-.287 0-.573 0-.86.002-.241.002-.483.003-.724.01-.132.003-.263.009-.395.015A9.154 9.154 0 0 0 4.348.15 5.492 5.492 0 0 0 2.85.645 5.04 5.04 0 0 0 .645 2.848c-.245.48-.4.972-.495 1.5-.093.52-.122 1.05-.136 1.576a35.2 35.2 0 0 0-.012.724C0 6.935 0 7.221 0 7.508v8.984c0 .287 0 .575.002.862.002.24.005.481.012.722.014.526.043 1.057.136 1.576.095.528.25 1.02.495 1.5a5.03 5.03 0 0 0 2.205 2.203c.48.244.97.4 1.498.495.52.093 1.05.124 1.576.138.241.007.483.009.724.01.287.002.573.002.86.002h8.984c.287 0 .573 0 .86-.002.241-.001.483-.003.724-.01a10.523 10.523 0 0 0 1.578-.138 5.322 5.322 0 0 0 1.498-.495 5.035 5.035 0 0 0 2.203-2.203c.245-.48.4-.972.495-1.5.093-.52.124-1.05.138-1.576.007-.241.009-.481.01-.722.002-.287.002-.575.002-.862V7.508c0-.287 0-.573-.002-.86a33.662 33.662 0 0 0-.01-.724 10.5 10.5 0 0 0-.138-1.576 5.328 5.328 0 0 0-.495-1.5A5.039 5.039 0 0 0 21.152.645 5.32 5.32 0 0 0 19.654.15a10.493 10.493 0 0 0-1.578-.138 34.98 34.98 0 0 0-.722-.01C17.067 0 16.779 0 16.492 0H7.508zm6.035 3.41c4.114 2.47 6.545 7.162 5.549 11.131-.024.093-.05.181-.076.272l.002.001c2.062 2.538 1.5 5.258 1.236 4.745-1.072-2.086-3.066-1.568-4.088-1.043a6.803 6.803 0 0 1-.281.158l-.02.012-.002.002c-2.115 1.123-4.957 1.205-7.812-.022a12.568 12.568 0 0 1-5.64-4.838c.649.48 1.35.902 2.097 1.252 3.019 1.414 6.051 1.311 8.197-.002C9.651 12.73 7.101 9.67 5.146 7.191a10.628 10.628 0 0 1-1.005-1.384c2.34 2.142 6.038 4.83 7.365 5.576C8.69 8.408 6.208 4.743 6.324 4.86c4.436 4.47 8.528 6.996 8.528 6.996.154.085.27.154.36.213.085-.215.16-.437.224-.668.708-2.588-.09-5.548-1.893-7.992z" />
        </svg>
    ),
};

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
        code: `createRouter(contract, {
  users: {
    getUser: async ({ params, error }) => {
      const user = await db.users.findById(params.id);

      if (!user) error({
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
        icon: icons.code,
        label: 'TS client',
        desc: 'RPC-like — call routes like functions',
        file: 'api-client.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `const client = createClient(contract, {
  baseUrl: 'http://localhost:3000',
});

const res = await client.users.getUser({
  params: {
    id: '1',
  },
});

if (res.status === 200) {
  res.body; // User — fully typed
} else {
  throw new Error(res.body.detail);
}`,
    },
    {
        icon: icons.phone,
        label: 'Swift client',
        desc: 'Native generated client for iOS & macOS',
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
  res.body // User — Codable
} catch {
  error // typed failure (e.g. .notFound)
}`,
    },
    {
        icon: icons.bot,
        label: 'MCP server',
        desc: 'Routes become tools for AI agents',
        file: 'app.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `createMcpEndpoint(api, app);

// each route → a typed MCP tool:
// GET → read-only · DELETE → destructive
// PUT → idempotent`,
    },
    {
        icon: icons.alert,
        label: 'Deprecation',
        desc: 'Mark once — it propagates everywhere',
        file: 'routes.ts',
        fileIcon: brandIcons.typescript,
        lang: 'ts',
        code: `/** @deprecated */
deleteUser: { ... }

// → editor strikethrough
// → OpenAPI deprecated: true
// → Swift @available`,
    },
];

const CONTRACT_CODE = `export const { k } = kizuna();

const UserSchema = createModel({
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

// Code window with the macOS-style dot header.
function DotsWindow({ lang, code }: { lang: string; code: string }) {
    return (
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-fd-border/60">
            <div className="flex gap-1.5 border-b border-fd-border/60 bg-fd-secondary/40 px-3 py-2">
                <span className="size-2 rounded-full bg-fd-border" />
                <span className="size-2 rounded-full bg-fd-border" />
                <span className="size-2 rounded-full bg-fd-border" />
            </div>
            <div className="flex-1 text-[11.5px] [&_button]:!hidden [&_figure]:!m-0 [&_figure]:!rounded-none [&_figure]:!border-0 [&_pre]:!py-2.5 [&_pre]:!text-[11.5px] [&_pre]:!leading-relaxed">
                <DynamicCodeBlock lang={lang} code={code} />
            </div>
        </div>
    );
}

// Code window with an editor-style filename + language icon tab.
function EditorWindow({ file, fileIcon, lang, code }: { file: string; fileIcon?: ReactNode; lang: string; code: string }) {
    return (
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-fd-border/60">
            <div className="flex gap-1.5 border-b border-fd-border/60 bg-fd-secondary/40 px-3 py-2">
                <span className="size-2 rounded-full bg-fd-border" />
                <span className="size-2 rounded-full bg-fd-border" />
                <span className="size-2 rounded-full bg-fd-border" />
            </div>
            <div className="flex-1 text-[11.5px] [&_button]:!hidden [&_figure]:!my-0 [&_figure]:!rounded-none [&_figure]:!border-0 [&_pre]:!text-[11.5px] [&_pre]:!leading-relaxed">
                <DynamicCodeBlock lang={lang} code={code} codeblock={{ title: file, icon: fileIcon }} />
            </div>
        </div>
    );
}

export function ContractExplorer() {
    return (
        <div className="not-prose my-6">
            <div className="flex flex-col rounded-xl border bg-fd-card p-4">
                <div className="mb-3.5 flex items-center gap-2.5">
                    <TsLogo className="size-4" />
                    <span className="font-mono text-sm font-medium">contract.ts</span>
                </div>
                <DotsWindow lang="ts" code={CONTRACT_CODE} />
            </div>
            <div className="mx-auto hidden h-4 w-px bg-fd-border sm:block" />
            <div className="relative hidden h-4 sm:block">
                <span className="absolute left-[calc((100%-12px)/4)] right-[calc((100%-12px)/4)] top-0 h-px bg-fd-border" />
                <span className="absolute left-[calc((100%-12px)/4)] top-0 h-4 w-px -translate-x-1/2 bg-fd-border" />
                <span className="absolute right-[calc((100%-12px)/4)] top-0 h-4 w-px translate-x-1/2 bg-fd-border" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {NODES.map((node) => (
                    <div key={node.label} className="flex flex-col rounded-xl border bg-fd-card p-4 transition-shadow hover:shadow-md">
                        <div className="mb-3 flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-fd-secondary/50 text-fd-muted-foreground">
                                {node.icon}
                            </span>
                            <div>
                                <div className="text-sm font-semibold leading-tight">{node.label}</div>
                                <div className="text-xs text-fd-muted-foreground">{node.desc}</div>
                            </div>
                        </div>
                        <EditorWindow file={node.file} fileIcon={node.fileIcon} lang={node.lang} code={node.code} />
                    </div>
                ))}
            </div>
        </div>
    );
}
