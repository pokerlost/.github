import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkConcurrency } from "./check_concurrency.mjs";
import { checkPromotion } from "./promotion.mjs";

const repository = "pokerlost/.github";
const event = (head, base, owner = repository) => ({ pull_request: { head: { ref: head, repo: { full_name: owner } }, base: { ref: base, repo: { full_name: repository } } } });
test("promotion only admits working to test, test to dev and dev to main", () => {
  for (const [head, base] of [["refactorG02Delivery", "test"], ["test", "dev"], ["dev", "main"]]) checkPromotion(event(head, base), repository);
  for (const [head, base] of [["main", "test"], ["test", "main"], ["feature/x", "test"], ["refactorG02Delivery", "dev"], ["dev", "other"]]) assert.throws(() => checkPromotion(event(head, base), repository));
  assert.throws(() => checkPromotion(event("test", "dev", "other/repo"), repository));
});
test("release DAG preserves every push and constrains credential scope", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /branches: \[test, dev, main\]/);
  assert.ok(!/paths:|paths-ignore:|cancel-in-progress: true/.test(ci));
  assert.match(ci, /needs: validate/);
  assert.match(ci, /queue: max/);
  assert.match(ci, /ref: \$\{\{ github.sha \}\}/);
  const shared = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(shared, /workflow_call:/);
  assert.match(shared, /group: release-allocation/);
  assert.match(shared, /queue: max/);
  assert.ok(!shared.includes("secrets: inherit"));
  assert.ok(!shared.includes("inputs.command"));
  assert.match(shared, /github.event_name == 'push'/);
  for (const file of [ci, shared]) {
    assert.ok(!file.includes("continue-on-error"));
    for (const match of file.matchAll(/uses: (\S+)/g)) if (!match[1].startsWith("./")) assert.match(match[1], /@[a-f0-9]{40}$/);
  }
});

test("unsupported adapters and malformed config fail before any GitHub call", () => {
  for (const change of [
    { RELEASE_ADAPTER: "shell" }, { RELEASE_ADAPTER: "python" },
    { RELEASE_BUNDLE_NAME: "../escape" }, { RELEASE_WORKFLOW: "../../other.yml" },
    { GITHUB_REPOSITORY: "invalid/repo/extra" }, { RELEASE_GATE: "$(false)" },
  ]) {
    const result = spawnSync(process.execPath, ["scripts/publish.mjs"], { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: repository, ...change } });
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes("Command failed: gh"), result.stderr);
  }
});

test("queue compatibility check rejects loss, cancellation and branch-scoped allocation", () => {
  const valid = "jobs:\n  release:\n    concurrency:\n      group: release-allocation\n      queue: max\n";
  checkConcurrency(valid);
  for (const bad of [valid.replace("queue: max", "queue: single"), valid.replace("group: release-allocation", "group: release-dev"), valid + "      cancel-in-progress: true\n", valid + "      queue: max\n"]) assert.throws(() => checkConcurrency(bad));
});

test("queue compatibility check rejects flow mappings, anchors and alternate key syntax", () => {
  for (const text of [
    "concurrency: {group: release-allocation, queue: single, cancel-in-progress: true}",
    "jobs: {release: {concurrency: {group: release-allocation, queue: single}}}",
    "concurrency: &queue\n  group: release-allocation\n  queue: max",
    "concurrency: *queue", '"concurrency": {queue: single}',
    "settings: &queue\n  queue: single\nconcurrency: *queue",
    "concurrency:\n  group: release-allocation\n  queue: &value max",
    "? concurrency\n: {queue: single}", "<<: *settings",
  ]) assert.throws(() => checkConcurrency(text), text);
});
