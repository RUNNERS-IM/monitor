#!/usr/bin/env node
// Checks every file in locales/ against ko.json, which is the source of truth:
// each locale must have exactly ko's keys and the same {{placeholders}} in every value.
// Run: node scripts/check-locales.mjs   (exits 1 when anything is off)

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const load = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const slots = (text) => [...new Set(String(text).match(/\{\{\s*\w+\s*\}\}/g) ?? [])].sort().join(" ");

const source = load("ko.json");
const sourceKeys = Object.keys(source);
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "ko.json").sort();
let problems = 0;

for (const file of files) {
  const table = load(file);
  const issues = [];
  for (const key of sourceKeys) {
    if (!(key in table)) issues.push(`missing key: ${key}`);
    else if (typeof table[key] !== "string") issues.push(`not a string: ${key}`);
    else if (slots(table[key]) !== slots(source[key])) {
      issues.push(`placeholders differ: ${key} (ko: "${slots(source[key])}", ${file}: "${slots(table[key])}")`);
    }
  }
  for (const key of Object.keys(table)) {
    if (!(key in source)) issues.push(`extra key: ${key}`);
  }
  if (issues.length) {
    problems += issues.length;
    console.log(`FAIL ${file}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  } else {
    console.log(`ok   ${file}`);
  }
}

console.log(`\n${files.length + 1} locales, ${sourceKeys.length} keys each, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
