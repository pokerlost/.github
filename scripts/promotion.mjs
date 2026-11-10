import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkPromotion(event, repository) {
  const pr = event.pull_request;
  assert.ok(pr, "Pull request event required");
  assert.equal(pr.base.repo.full_name, repository, "Wrong base repository");
  const { ref: head } = pr.head;
  const { ref: base } = pr.base;
  if (base === "test") {
    assert.match(head, /^[a-z][A-Za-z0-9]*$/, "Working branch must use lowerCamelCase");
    assert.ok(!["test", "dev", "main"].includes(head), "Working branch required");
  } else {
    assert.ok((base === "dev" && head === "test") || (base === "main" && head === "dev"), "Invalid promotion route");
    assert.equal(pr.head.repo.full_name, repository, "Promotion must use this repository");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPromotion(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), process.env.GITHUB_REPOSITORY);
}
