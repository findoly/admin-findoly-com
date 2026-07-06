const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const jsFiles = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && !['node_modules', 'data'].includes(item)) walk(full);
    if (stat.isFile() && full.endsWith('.js')) jsFiles.push(full);
  }
}

walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status);
}

console.log(`Checked ${jsFiles.length} JavaScript files.`);
