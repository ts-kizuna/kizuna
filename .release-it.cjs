/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
const { getTypes, ignoreReleaseCommits } = require('./tools/release-shared.cjs');

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
    },
    plugins: {
        '@release-it/conventional-changelog': {
            preset: {
                name: 'conventionalcommits',
                types: getTypes(),
            },
            gitRawCommitsOpts: {
                ignore: ignoreReleaseCommits,
            },
            writerOpts: {
                headerPartial:
                    '## [{{version}}]({{~@root.host}}/{{@root.owner}}/{{@root.repository}}/compare/{{previousTag}}...v{{version}})\n',
            },
        },
    },
};
