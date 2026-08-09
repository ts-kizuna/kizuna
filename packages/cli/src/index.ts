export {
    createJsDocMap,
    writeKizunaJsDoc,
    type ContractSource,
    collectExportedSchemaDocs,
    patchDeclarationDocs,
    type PatchResult,
} from './jsdoc-parser.js';
export { parseJsDoc, parseExampleValue, readJsDocEntry } from './jsdoc-block.js';
export { loadContract } from './load-contract.js';
export { lintDeprecations, type DeprecationLintWarning } from './lint-deprecations.js';
