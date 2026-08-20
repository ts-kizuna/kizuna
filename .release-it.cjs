/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
const { getTypes, ignoreReleaseCommits, whatBump } = require('./tools/release-shared.cjs');

const commitUrl = '{{~@root.host}}/{{@root.owner}}/{{@root.repository}}/commit/{{commit.hash}}';

const mainTemplate = `{{> header}}
{{#if noteGroups}}
{{#each noteGroups}}

### ⚠ {{title}}

{{#each notes}}
* {{#if commit.scope}}**{{commit.scope}}:** {{/if}}{{text}} ([{{commit.shortHash}}](${commitUrl}))
{{/each}}
{{/each}}
{{/if}}
{{#each commitGroups}}

{{#if title}}
### {{title}}

{{/if}}
{{#each commits}}
{{> commit root=@root}}
{{/each}}
{{/each}}
{{> footer}}
`;

module.exports = {
    git: {
        commit: true,
        commitMessage: 'chore: release v${version}',
        push: true,
        tag: true,
        tagName: 'v${version}',
        tagMatch: 'v[0-9]*',
        requireCleanWorkingDir: false,
        requireUpstream: false,
    },
    github: {
        release: true,
        releaseName: 'v${version}',
    },
    npm: {
        publish: false,
    },
    hooks: {
        'after:bump': 'node tools/sync-versions.cjs && git add package.json packages/*/package.json',
        'after:release': 'pnpm -r publish --no-git-checks --provenance',
    },
    plugins: {
        '@release-it/conventional-changelog': {
            preset: {
                name: 'conventionalcommits',
                types: getTypes(),
            },
            whatBump,
            gitRawCommitsOpts: {
                ignore: ignoreReleaseCommits,
            },
            writerOpts: {
                mainTemplate,
                headerPartial:
                    '## [{{version}}]({{~@root.host}}/{{@root.owner}}/{{@root.repository}}/compare/{{previousTag}}...v{{version}})\n',
            },
        },
    },
};
