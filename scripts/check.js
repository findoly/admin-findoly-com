const fs=require('fs');const path=require('path');
const roots=['app.js','bin','controllers','db','middleware','models','routes','services','scripts','utils'];let count=0;
function walk(target){if(!fs.existsSync(target))return;const stat=fs.statSync(target);if(stat.isDirectory())return fs.readdirSync(target).forEach(name=>walk(path.join(target,name)));if(!target.endsWith('.js'))return;const source=fs.readFileSync(target,'utf8');try{new Function(source);count++;}catch(error){console.error(`Syntax error in ${target}: ${error.message}`);process.exitCode=1;}}
roots.forEach(walk);if(!process.exitCode)console.log(`Checked ${count} JavaScript files.`);
