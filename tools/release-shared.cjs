/* eslint-disable no-undef */

const HIDDEN_IN_STRICT = new Set(['chore', 'ci', 'docs', 'test']);

const types = [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'chore', section: 'Chores' },
    { type: 'ci', section: 'CI' },
    { type: 'docs', section: 'Documentation' },
    { type: 'refactor', section: 'Refactors' },
    { type: 'perf', section: 'Performance' },
    { type: 'test', section: 'Tests' },
];

const ignoreReleaseCommits = /^chore(\([^)]*\))?:\s*release\s/;

// TODO(v2): drop this.
function whatBump(commits) {
    let breakingChanges = 0;
    let features = 0;

    for (const commit of commits) {
        if (commit.notes.length > 0) {
            breakingChanges += commit.notes.length;
        } else if (commit.type === 'feat') {
            features += 1;
        }
    }

    return {
        level: breakingChanges + features > 0 ? 1 : 2,
        reason: `There are ${breakingChanges} BREAKING CHANGES and ${features} features`,
    };
}

function getTypes() {
    return types;
}

function getStrictTypes() {
    return types.map((entry) => (HIDDEN_IN_STRICT.has(entry.type) ? { ...entry, hidden: true } : entry));
}

module.exports = { getTypes, getStrictTypes, ignoreReleaseCommits, whatBump };
