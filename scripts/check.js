const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const roots = [
  "app.js",
  "bin",
  "controllers",
  "db",
  "middleware",
  "models",
  "routes",
  "services",
  "scripts",
  "utils",
];
let jsCount = 0;
let viewCount = 0;
let inlineScriptCount = 0;

function walk(target, callback) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target))
      walk(path.join(target, name), callback);
    return;
  }
  callback(target);
}

function checkJavaScript() {
  for (const root of roots) {
    walk(root, (file) => {
      if (!file.endsWith(".js")) return;
      const source = fs.readFileSync(file, "utf8");
      try {
        new Function(source);
        jsCount += 1;
      } catch (error) {
        throw new Error(`Syntax error in ${file}: ${error.message}`);
      }
    });
  }
}

async function checkViews() {
  const files = [];
  walk("views", (file) => {
    if (
      file.endsWith(".ejs") &&
      !file.includes(`${path.sep}partials${path.sep}`)
    )
      files.push(file);
  });

  for (const file of files) {
    let html;
    try {
      html = await ejs.renderFile(file, {
        title: "Validation",
        subtitle: "Validation subtitle",
        appName: "Validation App",
      });
    } catch (error) {
      throw new Error(`EJS render error in ${file}: ${error.message}`);
    }

    viewCount += 1;
    const scriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scriptPattern)) {
      const source = match[1].trim();
      if (!source) continue;
      try {
        new Function(source);
        inlineScriptCount += 1;
      } catch (error) {
        throw new Error(`Inline JavaScript error in ${file}: ${error.message}`);
      }
    }
  }
}

async function main() {
  checkJavaScript();
  await checkViews();
  console.log(
    `Checked ${jsCount} JavaScript files, ${viewCount} EJS pages and ${inlineScriptCount} inline scripts.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
