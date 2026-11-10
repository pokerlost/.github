import assert from "node:assert/strict";
import test from "node:test";
import { nextVersion, parseVersion, shouldBeLatest, validateAllocation, validateEvent } from "./publish.mjs";

test("version resolver preserves native target and orders numeric prereleases", () => {
  const tags = ["v0.1.0", "v0.3.0-dev.2", "v0.3.0-dev.9", "v0.3.0-dev.10"];
  assert.equal(nextVersion(tags, "0.3.0-dev.2", "dev"), "0.3.0-dev.11");
  assert.equal(nextVersion(tags, "0.3.0-dev.2", "main"), "0.3.0");
  tags.push("v0.3.0");
  assert.equal(nextVersion(tags, "0.3.0-dev.2", "main"), "0.3.1");
  assert.equal(nextVersion(tags, "0.3.0-dev.2", "dev"), "0.3.1-dev.0");
  for (const bad of ["v01.2.3", "1.2.3-dev.01", "1.2.3-rc.1", "not-a-version"]) assert.equal(parseVersion(bad), null);
  assert.throws(() => nextVersion(tags, "invalid", "main"));
  assert.throws(() => nextVersion(tags, "0.3.0", "test"));
});
test("three quick dev events allocate monotonically without merging branch identities", () => {
  const tags = ["v1.0.0"];
  for (let n = 0; n < 3; n++) {
    const version = nextVersion(tags, "1.0.0", "dev");
    assert.equal(version, `1.0.1-dev.${n}`);
    tags.push(`v${version}`);
  }
  assert.equal(nextVersion(tags, "1.0.0", "main"), "1.0.1");
});
test("retry identity rejects wrong tag target, channel, repository and event", () => {
  const event = { runId: "123", branch: "dev", sha: "a".repeat(40), eventCreatedAt: "2026-11-10T00:00:00Z" };
  const allocation = { schemaVersion: 1, repository: "pokerlost/.github", adapter: "version-file", bundleName: "pokerlost-community", workflow: ".github/workflows/ci.yml", gate: "validate", ...event, version: "1.2.3-dev.4" };
  validateAllocation(allocation, event, event.sha);
  for (const change of [{ sha: "b".repeat(40) }, { runId: "124" }, { branch: "main" }, { repository: "other/repo" }, { version: "1.2.3" }]) assert.throws(() => validateAllocation({ ...allocation, ...change }, event, event.sha));
  assert.throws(() => validateAllocation(allocation, event, "c".repeat(40)));
});
test("source event accepts an old exact SHA but never a mutable branch replacement", () => {
  const event = { runId: "123", branch: "main", sha: "a".repeat(40) };
  const run = { id: 123, event: "push", path: ".github/workflows/ci.yml", head_branch: "main", head_sha: event.sha };
  validateEvent(run, event);
  for (const change of [{ head_sha: "b".repeat(40) }, { event: "pull_request" }, { head_branch: "dev" }, { id: 124 }, { path: "other.yml" }]) assert.throws(() => validateEvent({ ...run, ...change }, event));
});

test("recovering an older event never replaces a newer source as latest", () => {
  const old = { runId: "10", branch: "main", version: "1.0.2", eventCreatedAt: "2026-11-10T00:00:00Z" };
  const newer = { runId: "11", branch: "main", version: "1.0.1", eventCreatedAt: "2026-11-10T01:00:00Z" };
  const release = { tag_name: "v1.0.1", draft: false, prerelease: false, body: JSON.stringify(newer) };
  assert.equal(shouldBeLatest(old, [release]), false);
  assert.equal(shouldBeLatest(newer, [release]), true);
  const recovered = { ...release, tag_name: "v1.0.2", body: JSON.stringify(old) };
  assert.equal(shouldBeLatest(newer, [release, recovered]), true);
  const sameSecond = { ...newer, eventCreatedAt: old.eventCreatedAt };
  assert.equal(shouldBeLatest(old, [{ ...release, body: JSON.stringify(sameSecond) }]), false);
  assert.equal(shouldBeLatest(sameSecond, [recovered]), true);
  assert.equal(shouldBeLatest({ ...old, branch: "dev" }, []), false);
  assert.equal(shouldBeLatest(old, [{ ...release, body: "Legacy", published_at: newer.eventCreatedAt }]), false);
  assert.equal(shouldBeLatest(old, [{ ...release, body: "Legacy" }]), false);
});
