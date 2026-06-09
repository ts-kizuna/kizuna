export {
    createDeprecationMap,
    writeKizunaDeprecations,
    type ContractSource,
    collectExportedSchemaDocs,
    patchDeclarationDocs,
    type PatchResult,
} from './deprecation-parser.js';
export { loadContract } from './load-contract.js';
export { lintDeprecations, type DeprecationLintWarning } from './lint-deprecations.js';
