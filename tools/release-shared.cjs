/* eslint-disable no-undef */

const HIDDEN_IN_STRICT = new Set(['chore', 'ci', 'docs']);

const types = [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'chore', section: 'Chores' },
    { type: 'ci', section: 'CI' },
    { type: 'docs', section: 'Documentation' },
    { type: 'refactor', section: 'Refactors' },
    { type: 'perf', section: 'Performance' },
];

const ignoreReleaseCommits = /^chore(\([^)]*\))?:\s*release\s/;

function getTypes() {
    return types;
}

function getStrictTypes() {
    return types.map((entry) => (HIDDEN_IN_STRICT.has(entry.type) ? { ...entry, hidden: true } : entry));
}

module.exports = { getTypes, getStrictTypes, ignoreReleaseCommits };
