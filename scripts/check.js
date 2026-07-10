const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const jsFiles = [];
const ignoredDirectories = new Set(['node_modules', 'data', 'public', 'views']);

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);

    if (stat.isDirectory() && !ignoredDirectories.has(item)) walk(full);
    if (stat.isFile() && full.endsWith('.js')) jsFiles.push(full);
  }
}

for (const directory of [
  'config',
  'controllers',
  'db',
  'middleware',
  'models',
  'repositories',
  'routes',
  'scripts',
  'services',
  'test',
  'utils'
]) {
  walk(path.join(root, directory));
}

jsFiles.push(path.join(root, 'app.js'));
jsFiles.push(path.join(root, 'bin', 'www'));

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status);
}

console.log(`Checked ${jsFiles.length} JavaScript files.`);
