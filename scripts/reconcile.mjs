// Read-only reconciliation: original event identity plus authenticated metadata bytes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuration, validateAllocation, validateConfiguration, validateEvent } from "./publish.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function verifyRelease(run, repository, release, tag, metadata, expected = configuration()) {
  try {
    validateConfiguration(expected);
    assert.equal(repository, expected.repository);
    const event = { runId: String(run.id), sha: run.head_sha, branch: run.head_branch, eventCreatedAt: run.created_at };
    validateEvent(run, event, expected);
    const allocation = JSON.parse(release.body);
    assert.equal(tag?.object.type, "commit");
    validateAllocation(allocation, event, tag.object.sha, expected);
    assert.deepEqual(JSON.parse(tag.message), allocation);
    assert.equal(release.draft, false);
    assert.equal(release.prerelease, event.branch === "dev");
    assert.equal(release.tag_name, `v${allocation.version}`);
    const bundle = `${allocation.bundleName}-${allocation.version}.tgz`;
    const asset = (name) => {
      const matches = release.assets.filter((item) => item.name === name);
      assert.equal(matches.length, 1, "Missing or ambiguous release asset");
      assert.match(matches[0].digest, /^sha256:[a-f0-9]{64}$/);
      return matches[0];
    };
    for (const [name, bytes] of [["release-manifest.json", metadata.manifest], ["checksums.sha256", metadata.checksums]]) {
      assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1024 * 1024, "Missing or oversized metadata bytes");
      assert.equal(asset(name).digest, `sha256:${digest(bytes)}`, "Downloaded metadata digest conflict");
    }
    const { source, artifact, ...manifestAllocation } = JSON.parse(metadata.manifest.toString("utf8"));
    assert.deepEqual(manifestAllocation, allocation, "Manifest allocation conflict");
    assert.equal(source.commit, event.sha);
    assert.equal(source.dirty, false);
    assert.match(source.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(source.transformation, `${expected.adapter} version injection in isolated git archive`);
    assert.equal(artifact.name, bundle);
    assert.equal(artifact.version, allocation.version, "Native metadata version conflict");
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(asset(bundle).digest, `sha256:${artifact.sha256}`, "Bundle digest conflict");
    assert.equal(metadata.checksums.toString("utf8"), `${artifact.sha256}  ${bundle}\n${digest(metadata.manifest)}  release-manifest.json\n`, "Checksum contents conflict");
    return true;
  } catch { return false; }
}
export function reconcile(since) {
  const expected = configuration();
  validateConfiguration(expected);
  const { repository, workflow } = expected;
  assert.ok(since && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since) && Number.isFinite(Date.parse(since)), "Provide the actual bootstrap UTC timestamp");
  const get = (path) => JSON.parse(execFileSync("gh", ["api", "--hostname", "github.com", `repos/${repository}/${path}`, "--paginate", "--slurp"], { encoding: "utf8" }));
  const runs = get(`actions/workflows/${workflow.split("/").at(-1)}/runs?event=push&per_page=100`).flatMap((page) => page.workflow_runs);
  const releases = get("releases?per_page=100").flat();
  let missing = 0;
  for (const run of runs.filter((item) => ["dev", "main"].includes(item.head_branch) && item.created_at >= since)) {
    const found = releases.find((release) => {
      try { const event = JSON.parse(release.body); return event.repository === repository && event.runId === String(run.id); }
      catch { return false; }
    });
    let verified = false;
    if (found) {
      try {
        const ref = get(`git/ref/tags/${found.tag_name}`)[0];
        const tag = ref.object.type === "tag" ? get(`git/tags/${ref.object.sha}`)[0] : undefined;
        const bytes = (name) => {
          const matches = found.assets.filter((item) => item.name === name);
          assert.equal(matches.length, 1);
          assert.ok(Number.isSafeInteger(matches[0].id) && matches[0].id > 0);
          return execFileSync("gh", ["api", "--hostname", "github.com", `repos/${repository}/releases/assets/${matches[0].id}`, "--header", "Accept: application/octet-stream"], { maxBuffer: 1024 * 1024 });
        };
        verified = verifyRelease(run, repository, found, tag, { manifest: bytes("release-manifest.json"), checksums: bytes("checksums.sha256") }, expected);
      } catch { verified = false; }
    }
    if (!verified) missing++;
    console.log(JSON.stringify({ runId: run.id, sha: run.head_sha, branch: run.head_branch, conclusion: run.conclusion, release: verified ? found.html_url : "MISSING_OR_CONFLICT", recovery: verified ? null : `gh run rerun ${run.id} --repo ${repository}` }));
  }
  return missing;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (reconcile(process.argv[2])) process.exitCode = 1;
}
