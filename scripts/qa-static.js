#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);

function walk(directory, predicate, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, predicate, output);
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function fail(message) {
  console.error(`QA failed: ${message}`);
  process.exitCode = 1;
}

function checkJavaScriptSyntax() {
  const files = walk(root, (file) => file.endsWith(".js"));
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) fail(`${path.relative(root, file)}\n${result.stderr}`);
  }
  console.log(`✓ JavaScript syntax: ${files.length} files`);
}

function checkInlineScripts() {
  const views = walk(path.join(root, "views"), (file) => file.endsWith(".ejs"));
  let count = 0;
  for (const view of views) {
    const text = fs.readFileSync(view, "utf8");
    const pattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const opening = text.slice(match.index, text.indexOf(">", match.index) + 1);
      if (/\bsrc\s*=/i.test(opening)) continue;
      const script = match[1].replace(/<%[-_=#]?[\s\S]*?%>/g, "null");
      const temporary = path.join(os.tmpdir(), `findoly-inline-${process.pid}-${count}.js`);
      fs.writeFileSync(temporary, script);
      const result = spawnSync(process.execPath, ["--check", temporary], { encoding: "utf8" });
      fs.rmSync(temporary, { force: true });
      if (result.status !== 0) fail(`${path.relative(root, view)} inline script ${count + 1}\n${result.stderr}`);
      count += 1;
    }
  }
  console.log(`✓ EJS inline-script syntax: ${count} blocks`);
}

function viewPath(name) {
  return path.join(root, "views", `${name}.ejs`);
}

function checkViewsAndFrontendRoutes() {
  const errors = [];
  for (const file of [...walk(path.join(root, "controllers"), (item) => item.endsWith(".js")), ...walk(path.join(root, "routes"), (item) => item.endsWith(".js"))]) {
    const text = fs.readFileSync(file, "utf8");
    for (const expression of [/res\.render\(["']([^"']+)["']/g, /render\(["']([^"']+)["']/g]) {
      let match;
      while ((match = expression.exec(text))) {
        if (!fs.existsSync(viewPath(match[1]))) errors.push(`${path.relative(root, file)} references missing view ${match[1]}`);
      }
    }
  }
  for (const file of walk(path.join(root, "views"), (item) => item.endsWith(".ejs"))) {
    const text = fs.readFileSync(file, "utf8");
    const expression = /include\(["']([^"']+)["']/g;
    let match;
    while ((match = expression.exec(text))) {
      let target = path.resolve(path.dirname(file), match[1]);
      if (!target.endsWith(".ejs")) target += ".ejs";
      if (!fs.existsSync(target)) errors.push(`${path.relative(root, file)} references missing include ${target}`);
    }
  }
  const frontendRoutes = fs.readFileSync(path.join(root, "routes", "frontend.js"), "utf8");
  const frontendController = fs.readFileSync(path.join(root, "controllers", "frontendController.js"), "utf8");
  const exported = new Set([...frontendController.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*render\(/gm)].map((match) => match[1]));
  for (const match of frontendRoutes.matchAll(/\bpage\.([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(match[1])) errors.push(`routes/frontend.js references missing page.${match[1]}`);
  }
  if (errors.length) errors.forEach(fail);
  console.log(`✓ Views and frontend routes: ${walk(path.join(root, "views"), (item) => item.endsWith(".ejs")).length} views`);
}

function controllerExports(text) {
  const output = new Set([...text.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]));
  const object = text.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  if (object) {
    for (const item of object[1].split(",")) {
      const name = item.trim().split(":", 1)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) output.add(name);
    }
  }
  return output;
}

function checkApiRouteHandlers() {
  const errors = [];
  let checked = 0;
  for (const route of walk(path.join(root, "routes"), (file) => file.endsWith(".js"))) {
    if (path.basename(route) === "frontend.js") continue;
    const text = fs.readFileSync(route, "utf8");
    const imports = new Map();
    for (const match of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(["']([^"']+)["']\)/g)) {
      if (!match[2].startsWith("../controllers/")) continue;
      let target = path.resolve(path.dirname(route), match[2]);
      if (!target.endsWith(".js")) target += ".js";
      imports.set(match[1], target);
    }
    for (const [name, target] of imports) {
      if (!fs.existsSync(target)) {
        errors.push(`${path.relative(root, route)} imports missing controller ${target}`);
        continue;
      }
      const exported = controllerExports(fs.readFileSync(target, "utf8"));
      const expression = new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const match of text.matchAll(expression)) {
        checked += 1;
        if (!exported.has(match[1])) errors.push(`${path.relative(root, route)} references missing ${name}.${match[1]}`);
      }
    }
  }
  if (errors.length) errors.forEach(fail);
  console.log(`✓ API route handlers: ${checked} references`);
}

function checkManifestLock() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const lockedRoot = lock.packages?.[""] || {};
  for (const section of ["dependencies", "devDependencies"]) {
    const left = manifest[section] || {};
    const right = lockedRoot[section] || {};
    if (JSON.stringify(left) !== JSON.stringify(right)) fail(`package-lock root ${section} does not match package.json`);
  }
  if (manifest.engines?.node !== lockedRoot.engines?.node) fail("package-lock Node engine does not match package.json");
  console.log("✓ package.json and package-lock.json root metadata match");
}

checkJavaScriptSyntax();
checkInlineScripts();
checkViewsAndFrontendRoutes();
checkApiRouteHandlers();
checkManifestLock();

if (!process.exitCode) console.log("Static production QA passed.");
