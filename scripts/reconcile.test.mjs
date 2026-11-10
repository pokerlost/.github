import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyRelease } from "./reconcile.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const repository = "pokerlost/.github";
  const run = { id: 123, event: "push", path: ".github/workflows/ci.yml", head_sha: "a".repeat(40), head_branch: "dev", created_at: "2026-11-10T00:00:00Z" };
  const event = { schemaVersion: 1, repository, adapter: "version-file", workflow: run.path, gate: "validate", runId: "123", sha: run.head_sha, branch: "dev", eventCreatedAt: run.created_at, version: "1.2.3-dev.4", bundleName: "pokerlost-community" };
  const bundle = `${event.bundleName}-${event.version}.tgz`;
  const artifact = { name: bundle, version: event.version, sha256: digest(Buffer.from("synthetic checked bundle")) };
  const source = { commit: run.head_sha, dirty: false, contentSha256: "c".repeat(64), transformation: "version-file version injection in isolated git archive" };
  const manifest = Buffer.from(JSON.stringify({ ...event, source, artifact }));
  const checksums = Buffer.from(`${artifact.sha256}  ${bundle}\n${digest(manifest)}  release-manifest.json\n`);
  const tag = { object: { type: "commit", sha: run.head_sha }, message: JSON.stringify(event) };
  const assets = [{ name: "release-manifest.json", digest: `sha256:${digest(manifest)}` }, { name: "checksums.sha256", digest: `sha256:${digest(checksums)}` }, { name: bundle, digest: `sha256:${artifact.sha256}` }];
  const release = { tag_name: `v${event.version}`, prerelease: true, draft: false, body: JSON.stringify(event), assets };
  return { repository, run, event, tag, release, metadata: { manifest, checksums } };
}
const verify = (f) => verifyRelease(f.run, f.repository, f.release, f.tag, f.metadata);
test("reconciliation authenticates manifest/checksum bytes and the expected original allocation", () => {
  const f = fixture();
  assert.equal(verify(f), true);
  for (const change of [{ assets: f.release.assets.slice(0, 2) }, { draft: true }, { prerelease: false }, { tag_name: "v9.9.9" }, { body: "legacy notes" }]) assert.equal(verify({ ...f, release: { ...f.release, ...change } }), false);
  assert.equal(verify({ ...f, tag: { ...f.tag, object: { type: "commit", sha: "c".repeat(40) } } }), false);
  assert.equal(verify({ ...f, run: { ...f.run, created_at: "2026-11-11T00:00:00Z" } }), false);
  assert.equal(verify({ ...f, metadata: { ...f.metadata, manifest: Buffer.from("tampered") } }), false);
  assert.equal(verify({ ...f, metadata: { ...f.metadata, checksums: Buffer.from("tampered") } }), false);
  assert.equal(verify({ ...f, release: { ...f.release, assets: f.release.assets.map((asset) => ({ ...asset, digest: `sha256:${"0".repeat(64)}` })) } }), false);
});
test("reconciliation rejects unsupported adapters, wrong workflows/gates/bundles and dev stable versions", () => {
  for (const change of [{ adapter: "shell" }, { workflow: ".github/workflows/other.yml" }, { gate: "not-validated" }, { bundleName: "unreviewed" }, { version: "1.2.3" }, { runId: "124" }, { schemaVersion: 2 }]) {
    const f = fixture();
    const allocation = { ...f.event, ...change };
    f.release.body = JSON.stringify(allocation); f.tag.message = JSON.stringify(allocation);
    assert.equal(verify(f), false, JSON.stringify(change));
  }
});
test("semantically corrupted manifests fail even when their metadata digest is internally consistent", () => {
  for (const change of [{ source: { commit: "d".repeat(40), dirty: false, contentSha256: "c".repeat(64), transformation: "version-file version injection in isolated git archive" } }, { artifact: { name: "pokerlost-community-1.2.3-dev.4.tgz", version: "9.9.9", sha256: "e".repeat(64) } }, { workflow: ".github/workflows/unreviewed.yml" }]) {
    const f = fixture();
    const manifest = Buffer.from(JSON.stringify({ ...JSON.parse(f.metadata.manifest), ...change }));
    f.metadata.manifest = manifest;
    f.release.assets[0].digest = `sha256:${digest(manifest)}`;
    assert.equal(verify(f), false, JSON.stringify(change));
  }
});
