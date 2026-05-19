/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = rootPackage.version;

const packagesDirectory = path.join(root, 'packages');

for (const name of fs.readdirSync(packagesDirectory)) {
    const packageJsonPath = path.join(packagesDirectory, name, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.version = version;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
}

console.log(`Synced version ${version} to all packages`);
