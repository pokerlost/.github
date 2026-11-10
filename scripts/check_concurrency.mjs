// GitHub added queue:max before the pinned actionlint parser learned this key.
// Validate that extension narrowly; actionlint still validates all other YAML syntax.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkConcurrency(text) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    // This dependency-free checker deliberately supports only literal YAML keys and
    // block concurrency mappings. Reject alternate YAML representations instead of
    // letting actionlint's one unsupported-key exception conceal their semantics.
    assert.ok(!/^\s*(?:["'].*["']\s*:|[?:]\s|<<\s*:)/.test(line), "Quoted, explicit or merged YAML keys are unsupported");
    assert.ok(!/^\s*[A-Za-z_][\w-]*:\s*[&*!]/.test(line), "YAML aliases, anchors and tags are unsupported");
    if (!/\bconcurrency\s*:/.test(line)) continue;
    const match = /^( *)concurrency:\s*(?:#.*)?$/.exec(line);
    assert.ok(match, "Concurrency must be a literal block mapping; flow syntax and aliases are unsupported");
    const indent = match[1].length;
    const fields = [];
    for (let next = index + 1; next < lines.length; next++) {
      if (/^\s*(?:#.*)?$/.test(lines[next])) continue;
      if (lines[next].search(/\S/) <= indent) break;
      fields.push(lines[next].trim());
    }
    if (!fields.some((field) => field.startsWith("queue:"))) continue;
    assert.equal(fields.filter((field) => field.startsWith("queue:")).length, 1, "Duplicate queue field");
    assert.ok(fields.includes("queue: max"), "Only queue: max is supported by the release contract");
    assert.ok(fields.includes("group: release-allocation"), "Use one repository-wide release queue");
    assert.ok(!fields.some((field) => field.startsWith("cancel-in-progress:") && field !== "cancel-in-progress: false"), "Release queue cannot cancel events");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of readdirSync(".github/workflows").filter((name) => /\.ya?ml$/.test(name))) checkConcurrency(readFileSync(`.github/workflows/${file}`, "utf8"));
  console.log("GitHub queue:max extension contract passed; remaining syntax is checked by actionlint.");
}
