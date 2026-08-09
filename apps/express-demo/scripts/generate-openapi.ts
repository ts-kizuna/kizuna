import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

const spec = generateOpenApi(contract);

const target = resolve(process.cwd(), 'openapi.yaml');
writeFileSync(target, spec('yaml'));

console.log(`Wrote ${target}`);
