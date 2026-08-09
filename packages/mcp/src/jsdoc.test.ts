import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assembleApi } from '@ts-kizuna/core/adapter';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { writeKizunaJsDoc } from '../../cli/src/jsdoc-parser.js';
import { contract } from '../../cli/src/contract.fixture.js';
import { createMcpServer } from './server.js';

const fixturePath = path.resolve(import.meta.dirname, '../../cli/src/contract.fixture.ts');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-mcp-jsdoc-'));
const previousCwd = process.cwd();

const api = assembleApi(contract, {
    router: {},
});

const listTools = async () => {
    const server = createMcpServer(api, {
        name: 'Test API',
        version: '1.0.0',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
        name: 'test-client',
        version: '1.0.0',
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await client.close();
    return tools;
};

describe('MCP tools from contract JSDoc', () => {
    beforeAll(() => {
        writeKizunaJsDoc([{ contract, contractPath: fixturePath }], path.join(workDir, '.kizuna'));
        process.chdir(workDir);
    });

    afterAll(() => {
        process.chdir(previousCwd);
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('describes a tool from the route JSDoc', async () => {
        const tools = await listTools();
        expect(tools.find((tool) => tool.name === 'newRoute')?.description).toContain('Creates a user from the submitted name.');
    });

    it('shows a route @example as an example input', async () => {
        const tools = await listTools();
        expect(tools.find((tool) => tool.name === 'newRoute')?.description).toContain('"fullName": "Ada Lovelace"');
    });

    it('marks a deprecated route in its tool description', async () => {
        const tools = await listTools();
        expect(tools.find((tool) => tool.name === 'oldRoute')?.description).toContain('Deprecated: use newRoute instead');
    });

    it('describes body fields in the tool input schema', async () => {
        const tools = await listTools();
        const body = tools.find((tool) => tool.name === 'newRoute')?.inputSchema.properties?.['body'] as
            | { properties?: Record<string, { description?: string }> }
            | undefined;
        expect(body?.properties?.['name']?.description).toBe('The display name.');
    });

    it('describes path parameters in the tool input schema', async () => {
        const tools = await listTools();
        const params = tools.find((tool) => tool.name === 'getUserByIdV2')?.inputSchema.properties?.['params'] as
            | { properties?: Record<string, { description?: string }> }
            | undefined;
        expect(params?.properties?.['id']?.description).toBe('The user id, as returned by listUsers.');
    });

    it('leaves the contract schemas untouched', async () => {
        await listTools();
        const body = contract.routes.newRoute.body as unknown as {
            def: { shape: Record<string, { meta: () => { description?: string } | undefined }> };
        };
        expect(body.def.shape['name']?.meta()?.description).toBeUndefined();
    });
});
