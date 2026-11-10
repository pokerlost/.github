// Adapted from serrja/baseRules@8434509933feaa71ba312f8d02caad7362766d5a (MIT).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = process.env.GITHUB_REPOSITORY ?? "pokerlost/.github";
const workflow = process.env.RELEASE_WORKFLOW ?? ".github/workflows/ci.yml";
const gate = process.env.RELEASE_GATE ?? "validate";
const adapter = process.env.RELEASE_ADAPTER ?? "version-file";
const bundleName = process.env.RELEASE_BUNDLE_NAME ?? "pokerlost-community";
const prefix = `repos/${repository}`;
const command = (name, args, options = {}) => execFileSync(name, args, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...options }).trim();
function api(path, data) {
  const args = ["api", "--hostname", "github.com", `${prefix}/${path}`];
  if (data) args.push("--method", "POST", "--input", "-");
  return JSON.parse(command("gh", args, data ? { input: JSON.stringify(data) } : {}));
}
function pages(path) {
  return JSON.parse(command("gh", ["api", "--hostname", "github.com", `${prefix}/${path}`, "--paginate", "--slurp"])).flat();
}
export function configuration() { return { repository, workflow, gate, adapter, bundleName }; }
export function validateConfiguration(expected = configuration()) {
  const { repository, workflow, gate, adapter, bundleName } = expected;
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(workflow, /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/);
  assert.match(gate, /^[A-Za-z0-9_ /()-]{1,100}$/);
  assert.ok(["version-file", "npm"].includes(adapter), "Unsupported release adapter");
  assert.match(bundleName, /^[a-z][a-z0-9-]{0,79}$/);
}
export function nativeVersion(directory = ".") {
  const value = adapter === "npm" ? JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")).version : readFileSync(resolve(directory, "VERSION"), "utf8").trim();
  assert.ok(parseVersion(value), "Invalid native version source");
  return value;
}
export function buildArtifact(staging, version) {
  assert.ok(parseVersion(version));
  const out = resolve(staging, "../", `${bundleName}-${version}.tgz`);
  if (adapter === "npm") {
    // Never run consumer lifecycle scripts with the release token.
    command("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts", "--allow-same-version"], { cwd: staging });
    assert.equal(nativeVersion(staging), version);
    const lock = JSON.parse(readFileSync(resolve(staging, "package-lock.json"), "utf8"));
    assert.equal(lock.version, version); assert.equal(lock.packages[""].version, version);
    const packed = JSON.parse(command("npm", ["pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", ".."], { cwd: staging }));
    assert.equal(packed.length, 1);
    assert.equal(packed[0].version, version);
    const path = resolve(staging, "..", packed[0].filename);
    const metadata = JSON.parse(command("tar", ["-xOf", path, "package/package.json"]));
    assert.equal(metadata.version, version);
    renameSync(path, out);
    return { path: out, version, sha256: createHash("sha256").update(readFileSync(out)).digest("hex") };
  }
  writeFileSync(resolve(staging, "VERSION"), `${version}\n`);
  assert.equal(nativeVersion(staging), version);
  command("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-czf", out, "-C", staging, "."]);
  assert.equal(command("tar", ["-xOf", out, "./VERSION"]), version);
  return { path: out, version, sha256: createHash("sha256").update(readFileSync(out)).digest("hex") };
}
export function parseVersion(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/.exec(tag);
  if (!match) return null;
  const values = match.slice(1).map((part) => part === undefined ? null : Number(part));
  assert.ok(values.every((part) => part === null || Number.isSafeInteger(part)), "Unsafe version number");
  return values;
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
export function nextVersion(tags, native, branch) {
  assert.ok(["dev", "main"].includes(branch), "Invalid release branch");
  const floor = parseVersion(native);
  assert.ok(floor, "Invalid native version");
  const versions = tags.map(parseVersion).filter(Boolean);
  const stable = versions.filter((v) => v[3] === null).sort(compare).at(-1);
  let base = floor.slice(0, 3);
  if (stable && compare(base, stable) <= 0) base = [stable[0], stable[1], stable[2] + 1];
  if (branch === "main") return base.join(".");
  const sameBase = versions.filter((v) => v[3] !== null && compare(v, base) === 0);
  const n = Math.max(-1, ...sameBase.map((v) => v[3])) + 1;
  return `${base.join(".")}-dev.${n}`;
}
export function validateEvent(run, event, expected = configuration()) {
  assert.equal(run.event, "push", "Only original push events may release");
  assert.equal(run.path, expected.workflow, "Unexpected source workflow");
  assert.equal(run.head_branch, event.branch, "Wrong event branch");
  assert.equal(run.head_sha, event.sha, "Wrong event SHA");
  assert.equal(String(run.id), event.runId, "Wrong event ID");
  assert.ok(["dev", "main"].includes(event.branch), "Invalid event branch");
  assert.match(event.sha, /^[a-f0-9]{40}$/);
  assert.match(event.runId, /^[1-9]\d*$/);
}
export function validateAllocation(allocation, event, target, expected = configuration()) {
  validateConfiguration(expected);
  assert.deepEqual(Object.keys(allocation).sort(), ["schemaVersion", "repository", "adapter", "bundleName", "workflow", "gate", "runId", "branch", "sha", "eventCreatedAt", "version"].sort(), "Unexpected allocation schema");
  assert.equal(allocation.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(event.eventCreatedAt)), "Invalid original event time");
  assert.equal(allocation.repository, expected.repository);
  assert.equal(allocation.adapter, expected.adapter);
  assert.equal(allocation.bundleName, expected.bundleName);
  assert.equal(allocation.workflow, expected.workflow);
  assert.equal(allocation.gate, expected.gate);
  assert.equal(allocation.runId, event.runId);
  assert.equal(allocation.branch, event.branch);
  assert.equal(allocation.sha, event.sha);
  assert.equal(allocation.eventCreatedAt, event.eventCreatedAt, "Event time conflict");
  assert.equal(target, event.sha, "Tag target conflict");
  const version = parseVersion(allocation.version);
  assert.ok(version, "Invalid allocated version");
  assert.equal(version[3] !== null, event.branch === "dev", "Release channel conflict");
}
function allocations() {
  const tags = pages("git/matching-refs/tags/v");
  return tags.map((tag) => {
    if (tag.object.type !== "tag") return { tag: tag.ref.slice(10) };
    const object = api(`git/tags/${tag.object.sha}`);
    let allocation;
    try { allocation = JSON.parse(object.message); } catch { /* Historical annotation. */ }
    return { tag: tag.ref.slice(10), allocation, target: object.object.sha };
  });
}
export function shouldBeLatest(allocation, releases) {
  if (allocation.branch !== "main") return false;
  const currentTime = Date.parse(allocation.eventCreatedAt);
  assert.ok(Number.isFinite(currentTime), "Missing original event time");
  return !releases.some((release) => {
    if (release.draft || release.prerelease || release.tag_name === `v${allocation.version}`) return false;
    let previous;
    try { previous = JSON.parse(release.body); } catch { /* Legacy release. */ }
    const previousTime = Date.parse(previous?.eventCreatedAt ?? release.published_at);
    if (!Number.isFinite(previousTime) || previousTime > currentTime) return true;
    if (previousTime < currentTime) return false;
    if (!/^[1-9]\d*$/.test(previous?.runId ?? "") || !/^[1-9]\d*$/.test(allocation.runId ?? "")) return true;
    return BigInt(previous.runId) > BigInt(allocation.runId);
  });
}
export function publish(event) {
  validateConfiguration();
  const run = api(`actions/runs/${event.runId}`);
  validateEvent(run, event);
  assert.ok(Number.isFinite(Date.parse(run.created_at)), "Missing original event time");
  event = { ...event, eventCreatedAt: run.created_at };
  assert.equal(command("git", ["rev-parse", "HEAD"]), event.sha, "Checkout must match event");
  assert.equal(command("git", ["status", "--porcelain"]), "", "Release requires clean source");
  const jobs = pages(`actions/runs/${event.runId}/jobs?filter=latest&per_page=100`);
  // This endpoint has an object envelope rather than a list.
  const checked = jobs.flatMap((page) => page.jobs ?? []);
  assert.ok(checked.some((job) => job.name === gate && job.conclusion === "success"), "Native gate has not passed for this event");
  const records = allocations();
  const matching = records.filter((row) => row.allocation?.runId === event.runId);
  assert.ok(matching.length <= 1, "Duplicate event allocation");
  let allocation = matching[0]?.allocation;
  if (allocation) {
    validateAllocation(allocation, event, matching[0].target);
    assert.equal(matching[0].tag, `v${allocation.version}`, "Tag/version conflict");
  } else {
    const native = nativeVersion();
    allocation = { schemaVersion: 1, repository, adapter, bundleName, workflow, gate, ...event, version: nextVersion(records.map((row) => row.tag), native, event.branch) };
    const tag = `v${allocation.version}`;
    const object = api("git/tags", { tag, message: JSON.stringify(allocation), object: event.sha, type: "commit" });
    api("git/refs", { ref: `refs/tags/${tag}`, sha: object.sha });
  }
  const tag = `v${allocation.version}`;
  const releases = pages("releases?per_page=100");
  const existing = releases.find((release) => release.tag_name === tag);
  const notes = JSON.stringify(allocation, null, 2);
  if (existing) {
    assert.equal(existing.body?.trim(), notes, "Existing release identity conflict");
    assert.equal(existing.prerelease, event.branch === "dev", "Existing channel conflict");
  }
  mkdirSync("coverage", { recursive: true });
  const staging = mkdtempSync(resolve(`coverage/release-${event.runId}-`));
  const archive = execFileSync("git", ["archive", "--format=tar", event.sha]);
  execFileSync("tar", ["-xf", "-", "-C", staging], { input: archive });
  const source = { commit: event.sha, dirty: false, contentSha256: createHash("sha256").update(archive).digest("hex"), transformation: `${adapter} version injection in isolated git archive` };
  const artifact = buildArtifact(staging, allocation.version);
  const artifactPath = artifact.path;
  const manifestPath = `${staging}/release-manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify({ ...allocation, source, artifact: { name: artifactPath.split("/").at(-1), sha256: artifact.sha256, version: artifact.version } }, null, 2)}\n`);
  writeFileSync(`${staging}/checksums.sha256`, `${artifact.sha256}  ${artifactPath.split("/").at(-1)}\n${createHash("sha256").update(readFileSync(manifestPath)).digest("hex")}  release-manifest.json\n`);
  const assets = [artifactPath, manifestPath, `${staging}/checksums.sha256`];
  const notesPath = `${staging}/release-notes.txt`;
  writeFileSync(notesPath, notes);
  if (!existing) {
    const args = ["release", "create", tag, "--repo", repository, "--verify-tag", "--target", event.sha, "--title", tag, "--notes-file", notesPath, "--draft"];
    if (event.branch === "dev") args.push("--prerelease");
    command("gh", args);
  }
  const release = JSON.parse(command("gh", ["release", "view", tag, "--repo", repository, "--json", "assets,isDraft"]));
  for (const path of assets) {
    const name = path.split("/").at(-1);
    const digest = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    const asset = release.assets.find((item) => item.name === name);
    if (asset) assert.equal(asset.digest, digest, "Existing asset conflict");
    else {
      assert.ok(release.isDraft, "Published release is missing assets");
      command("gh", ["release", "upload", tag, path, "--repo", repository]);
    }
  }
  const latest = shouldBeLatest(allocation, releases);
  command("gh", ["release", "edit", tag, "--repo", repository, "--draft=false", `--latest=${latest}`]);
  const final = JSON.parse(command("gh", ["release", "view", tag, "--repo", repository, "--json", "url,isDraft,isPrerelease,assets"]));
  assert.equal(final.isDraft, false);
  assert.equal(final.isPrerelease, event.branch === "dev");
  for (const path of assets) assert.equal(final.assets.find((item) => item.name === path.split("/").at(-1))?.digest, `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  const actual = allocations().find((row) => row.tag === tag);
  validateAllocation(actual.allocation, event, actual.target);
  console.log(final.url);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish({ runId: process.env.GITHUB_RUN_ID, branch: process.env.GITHUB_REF_NAME, sha: process.env.GITHUB_SHA });
}
