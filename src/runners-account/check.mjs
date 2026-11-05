// Fails when a copied runners-account file differs from what runners-app-kit/desktop/copy.mjs copied, so the four
// apps cannot drift apart. Usage: node <the copied folder>/check.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const changed = [];
for (const line of readFileSync(join(here, "runners-account.sum"), "utf8").split("\n")) {
  const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
  if (!match) continue;
  let hash = "";
  try {
    hash = createHash("sha256").update(readFileSync(join(here, match[2]))).digest("hex");
  } catch {
    hash = "missing";
  }
  if (hash !== match[1]) changed.push(match[2]);
}
if (changed.length) {
  console.error(`runners-account: ${changed.join(", ")} differ from runners-app-kit/desktop. Change them there and copy again.`);
  process.exit(1);
}
console.log("runners-account: same as runners-app-kit/desktop");
