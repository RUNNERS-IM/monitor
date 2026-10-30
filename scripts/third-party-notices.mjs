// Writes THIRD_PARTY_NOTICES.md: the license notices of every Rust crate (the native module in native/) and npm package
// (Electron, and the production dependencies) that ships inside Monitor.
// Why: Monitor is RUNNERS' own software, but the open source parts it is built from ask for their notices to travel
// with the app; the About window shows this file ("Open Source Notices"), like Split's.
// Run after changing dependencies: node scripts/third-party-notices.mjs (needs cargo and pnpm on PATH).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

/** The license file that matches the license picked from the expression, else any license file. */
function licenseText(dir, expression) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f));
  const want = /\bMIT\b/.test(expression) ? /mit/i : /\bISC\b/.test(expression) ? /isc/i : /bsd/i;
  const pick = files.find((f) => want.test(f)) ?? files.find((f) => !/apache/i.test(f)) ?? files[0];
  return pick ? readFileSync(join(dir, pick), "utf8").trim() : null;
}

const APACHE = /^\s*Apache License\s+Version 2\.0/;

// Why: some crates (objc2, webview2-com…) ship no license file, so their MIT notice is written from the package's own
// author list with the standard MIT text.
const mitText = (holders) => `Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
const entries = [];

// Rust: everything the native module links, following normal dependencies only (build tools are not shipped).
const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1"], join(root, "native")));
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const seen = new Set();
const queue = [meta.resolve.root];
while (queue.length) {
  const id = queue.pop();
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (!dep.dep_kinds.some((k) => k.kind === null) || seen.has(dep.pkg)) continue;
    seen.add(dep.pkg);
    queue.push(dep.pkg);
  }
}
for (const id of seen) {
  const p = byId.get(id);
  let text = licenseText(dirname(p.manifest_path), p.license ?? "");
  if (!text && /\bMIT\b/.test(p.license ?? "")) {
    text = mitText(p.authors.length ? p.authors.map((a) => a.replace(/\s*<[^>]*>/, "")).join(", ") : `the ${p.name} authors`);
  }
  const source = `https://crates.io/crates/${p.name}/${p.version}`;
  entries.push({ name: p.name, version: p.version, license: p.license ?? "see file", text, source });
}

// npm: the packages bundled into the page and the main process, and the ones the app loads at run time.
const npm = JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"], root));
for (const [license, packages] of Object.entries(npm)) {
  for (const p of packages) {
    entries.push({ name: p.name, version: p.versions.join(", "), license, text: licenseText(p.paths[0], license) });
  }
}

// Electron is the app's runtime. Why: it is a build tool in package.json (electron-builder copies it in), so the
// --prod list above leaves it out.
const electronDir = join(root, "node_modules", "electron");
const electronPkg = JSON.parse(readFileSync(join(electronDir, "package.json"), "utf8"));
entries.push({
  name: "electron",
  version: electronPkg.version,
  license: electronPkg.license,
  text:
    licenseText(electronDir, electronPkg.license) +
    `\n\nElectron includes Chromium and other open source software; their notices are in LICENSES.chromium.html, ` +
    `published with Electron ${electronPkg.version} at https://github.com/electron/electron/releases/tag/v${electronPkg.version}.`,
});

entries.sort((a, b) => a.name.localeCompare(b.name));
let apacheUsed = false;
const parts = [
  "# Third-Party Notices",
  "",
  "Monitor includes software from the projects below. Their copyright and license notices follow.",
  "The menu icons are drawn from Lucide (ISC License), listed under lucide-react.",
];
for (const e of entries) {
  parts.push("", `# ${e.name} ${e.version}`, "", `License: ${e.license}`);
  // Why: the Apache-2.0 text is the same for every crate, so it is printed once at the end instead of hundreds of times.
  if (e.text && APACHE.test(e.text)) {
    apacheUsed = true;
    parts.push("", "The Apache License 2.0 text is at the end of this file.");
  } else if (e.text) {
    parts.push("", e.text);
  } else if (/apache/i.test(e.license)) {
    apacheUsed = true;
    parts.push("", "The Apache License 2.0 text is at the end of this file.");
  } else if (e.source) {
    // Why: no license file ships in the package; its license and unmodified source are where it was published.
    parts.push("", `The package ships no license file. Its license text and source are at ${e.source}.`);
  }
}
if (apacheUsed) {
  const apache = entries.map((e) => e.text).find((t) => t && APACHE.test(t));
  if (apache) parts.push("", "# Apache License 2.0", "", apache);
}
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), parts.join("\n") + "\n");
console.log(`${entries.length} packages written to THIRD_PARTY_NOTICES.md`);
