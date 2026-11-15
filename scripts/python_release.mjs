// H02 Python data boundary. Never executes consumer source or packaging backends.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allocateEvent, allocations, api, pages, parseVersion, shouldBeLatest, validateEvent } from "./publish.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const execute = (name, args, options = {}) => execFileSync(name, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "inherit"], ...options });
const gh = (args) => JSON.parse(execute("gh", args));
const exactKeys = (value, names) => assert.deepEqual(Object.keys(value).sort(), names.split(" ").sort(), "Unexpected schema fields");
const positive = (value) => assert.match(value, /^[1-9]\d{0,18}$/);

export function pythonVersion(version) {
  const parsed = parseVersion(version);
  assert.ok(parsed, "Unsupported Python release version");
  return `${parsed.slice(0, 3).join(".")}${parsed[3] === null ? "" : `.dev${parsed[3]}`}`;
}
export function pythonConfiguration(env = process.env) {
  const expected = { repository: env.GITHUB_REPOSITORY, adapter: "python", workflow: env.RELEASE_WORKFLOW, gate: env.RELEASE_GATE, bundleName: env.RELEASE_BUNDLE_NAME, providerRef: env.RELEASE_PROVIDER_REF, contractSchema: env.RELEASE_SCHEMA, builderJob: env.RELEASE_BUILDER, versionTarget: env.RELEASE_VERSION_TARGET, wheelTags: JSON.parse(env.RELEASE_WHEEL_TAGS ?? "null") };
  validatePythonConfiguration(expected);
  return expected;
}
export function validatePythonConfiguration(c) {
  assert.equal(c.adapter, "python");
  assert.equal(c.contractSchema, "h02-python/v1");
  assert.match(c.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(c.workflow, /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/);
  for (const name of [c.gate, c.builderJob]) assert.match(name, /^[A-Za-z0-9_ /()-]{1,100}$/);
  assert.notEqual(c.gate, c.builderJob, "Preflight and builder must be separate jobs");
  assert.match(c.bundleName, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(c.bundleName.length <= 80);
  assert.match(c.providerRef, /^[a-f0-9]{40}$/);
  assert.ok(parseVersion(c.versionTarget)?.[3] === null, "Invalid reviewed native version target; require X.Y.Z");
  assert.equal(c.versionTarget.startsWith("v"), false);
  assert.ok(Array.isArray(c.wheelTags) && c.wheelTags.length > 0 && c.wheelTags.length <= 32);
  assert.equal(new Set(c.wheelTags).size, c.wheelTags.length);
  for (const tag of c.wheelTags) assert.match(tag, /^[a-z0-9_]+-[a-z0-9_]+-[a-z0-9_]+$/);
  assert.deepEqual(c.wheelTags, [...c.wheelTags].sort(), "Sort wheel variants explicitly");
}
export function validatePythonAllocation(a, event, target, c) {
  validatePythonConfiguration(c);
  exactKeys(a, "schemaVersion repository adapter bundleName workflow gate runId branch sha eventCreatedAt version providerRef contractSchema builderJob versionTarget wheelTags allocationAttempt pythonVersion");
  assert.equal(a.schemaVersion, 2);
  for (const key of ["repository", "adapter", "bundleName", "workflow", "gate", "providerRef", "contractSchema", "builderJob", "versionTarget", "wheelTags"]) assert.deepEqual(a[key], c[key], `Allocation ${key} conflict`);
  for (const key of ["runId", "branch", "sha", "eventCreatedAt"]) assert.equal(a[key], event[key], `Allocation ${key} conflict`);
  positive(a.runId); positive(a.allocationAttempt);
  assert.match(a.sha, /^[a-f0-9]{40}$/);
  assert.equal(target, a.sha, "Tag target conflict");
  assert.ok(Number.isFinite(Date.parse(a.eventCreatedAt)));
  assert.ok(["dev", "main"].includes(a.branch));
  assert.ok(parseVersion(a.version));
  assert.equal(parseVersion(a.version)[3] !== null, a.branch === "dev");
  assert.equal(a.pythonVersion, pythonVersion(a.version));
  if (event.runAttempt) assert.ok(BigInt(event.runAttempt) >= BigInt(a.allocationAttempt), "Attempt predates allocation");
}
export function validateJob(job, name, event) {
  assert.equal(job.name, name);
  assert.equal(job.conclusion, "success", `${name} gate has not passed`);
  assert.equal(String(job.run_id), event.runId);
  assert.equal(job.head_sha, event.sha);
  positive(String(job.id));
  if (job.run_attempt !== undefined) assert.equal(String(job.run_attempt), event.runAttempt);
}
export function validateRun(run, event, c, phase) {
  validateEvent(run, event, c);
  assert.equal(run.repository.full_name, c.repository);
  assert.equal(String(run.run_attempt), event.runAttempt, "Wrong run attempt");
  assert.ok(Number.isFinite(Date.parse(run.created_at)));
  const required = phase === "allocate" ? ["python-allocate.yml"] : ["python-allocate.yml", "python-publish.yml"];
  for (const file of required) {
    const path = `pokerlost/.github/.github/workflows/${file}@${c.providerRef}`;
    const refs = run.referenced_workflows?.filter((w) => w.path.startsWith(`pokerlost/.github/.github/workflows/${file}@`));
    assert.ok(refs?.length > 0 && refs.every((w) => w.path === path && w.sha === c.providerRef), "Workflow pin and provider-ref differ");
  }
}
function context(c, phase) {
  const event = { runId: process.env.GITHUB_RUN_ID, branch: process.env.GITHUB_REF_NAME, sha: process.env.GITHUB_SHA, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
  positive(event.runId); positive(event.runAttempt);
  const run = api(`actions/runs/${event.runId}`);
  validateRun(run, event, c, phase);
  event.eventCreatedAt = run.created_at;
  const jobs = pages(`actions/runs/${event.runId}/attempts/${event.runAttempt}/jobs?per_page=100`).flatMap((page) => page.jobs ?? []);
  const job = (name) => {
    const found = jobs.filter((row) => row.name === name);
    assert.equal(found.length, 1, "Missing or ambiguous job identity");
    validateJob(found[0], name, event);
    return found[0];
  };
  job(c.gate);
  return { event, run, job };
}
function recorded(a, event, c) {
  const matching = allocations().filter((row) => row.allocation?.runId === event.runId);
  assert.equal(matching.length, 1, "Missing or duplicate original allocation");
  validatePythonAllocation(matching[0].allocation, event, matching[0].target, c);
  assert.deepEqual(matching[0].allocation, a, "Allocation input differs from immutable tag");
  assert.equal(JSON.stringify(matching[0].allocation), JSON.stringify(a), "Preserve exact allocation JSON order");
  assert.equal(matching[0].tag, `v${a.version}`);
}
function sourcePyproject(c, sha, directory) {
  const response = api(`contents/pyproject.toml?ref=${sha}`);
  assert.equal(response.type, "file"); assert.equal(response.encoding, "base64");
  assert.ok(response.size > 0 && response.size <= 1024 * 1024, "Source pyproject size outside limits");
  const raw = Buffer.from(response.content, "base64");
  assert.equal(raw.length, response.size);
  const path = join(directory, "source-pyproject.toml"); writeFileSync(path, raw);
  execute("python3", ["-I", join(here, "python_artifacts.py"), "source", "--pyproject", path, "--package-name", c.bundleName, "--version-target", c.versionTarget]);
  return path;
}
export function allocatePython(c = pythonConfiguration()) {
  const { event } = context(c, "allocate");
  sourcePyproject(c, event.sha, mkdtempSync(join(tmpdir(), "h02-python-source-")));
  // Attempt belongs to the build receipt; the immutable allocation keeps the first
  // successful preflight attempt. A full rerun reuses the same original event.
  const { runAttempt, ...identity } = event;
  const a = allocateEvent(identity, c, c.versionTarget, (value, original, target) => validatePythonAllocation(value, { ...original, runAttempt }, target, c), (version) => ({ schemaVersion: 2, providerRef: c.providerRef, contractSchema: c.contractSchema, builderJob: c.builderJob, versionTarget: c.versionTarget, wheelTags: c.wheelTags, allocationAttempt: runAttempt, pythonVersion: pythonVersion(version) }));
  const build = buildRecord(a);
  const outputs = { allocation: JSON.stringify(a), "allocation-sha256": sha256(JSON.stringify(a)), "release-version": a.version, "python-version": a.pythonVersion, "source-sha": a.sha, tag: `v${a.version}`, "build-required": build ? "false" : "true", "artifact-id": build?.provenance.artifactId ?? "" };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  return outputs;
}
export function validateReceipt(receipt, a, event, builder, files) {
  exactKeys(receipt, "schemaVersion allocationSha256 runId runAttempt sourceSha builderJob builderJobId buildTool files");
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.allocationSha256, sha256(JSON.stringify(a)));
  assert.equal(receipt.runId, event.runId); assert.equal(receipt.runAttempt, event.runAttempt);
  assert.equal(receipt.sourceSha, event.sha);
  assert.equal(receipt.builderJob, a.builderJob); assert.equal(receipt.builderJobId, String(builder.id));
  exactKeys(receipt.buildTool, "backend backendVersion frontend frontendVersion versionInjection");
  for (const value of Object.values(receipt.buildTool)) assert.ok(typeof value === "string" && /^[A-Za-z0-9_.+ /:=-]{1,200}$/.test(value), "Missing build tool or native injection evidence");
  assert.equal(receipt.buildTool.backend, files.find((f) => f.name.endsWith(".tar.gz"))?.buildBackend, "Receipt backend differs from native pyproject");
  assert.deepEqual(receipt.files, files, "Native receipt metadata/checksum conflict");
}
export function verifyAttestationResults(results, file, a, attempt) {
  assert.ok(Array.isArray(results) && results.length > 0, "Missing verified attestation");
  const valid = results.filter((row) => {
    const result = row.verificationResult;
    const cert = result?.signature?.certificate;
    const statement = result?.statement;
    return cert?.runInvocationURI === `https://github.com/${a.repository}/actions/runs/${a.runId}/attempts/${attempt}` &&
      cert.sourceRepositoryURI === `https://github.com/${a.repository}` && cert.sourceRepositoryDigest === a.sha &&
      cert.sourceRepositoryRef === `refs/heads/${a.branch}` &&
      cert.buildSignerURI === `https://github.com/${a.repository}/${a.workflow}@refs/heads/${a.branch}` && cert.buildSignerDigest === a.sha &&
      result.verifiedTimestamps?.length > 0 && statement?.predicateType === "https://slsa.dev/provenance/v1" &&
      statement.subject?.some((s) => s.digest?.sha256 === file.sha256 && basename(s.name) === file.name) &&
      statement.predicate?.runDetails?.metadata?.invocationId === cert.runInvocationURI;
  });
  assert.ok(valid.length > 0, "Attestation source/signer/run/attempt/subject conflict");
  return valid;
}
function attest(path, file, a, attempt, bundlePath) {
  const args = ["attestation", "verify", path, "--repo", a.repository, "--source-digest", a.sha, "--source-ref", `refs/heads/${a.branch}`, "--signer-workflow", `${a.repository}/${a.workflow}`, "--signer-digest", a.sha, "--deny-self-hosted-runners", "--predicate-type", "https://slsa.dev/provenance/v1", "--format", "json"];
  if (bundlePath) args.push("--bundle", bundlePath);
  const rows = verifyAttestationResults(gh(args), file, a, attempt);
  const bundles = rows.map((row) => { assert.ok(row.attestation?.bundle, "Missing signed bundle"); return row.attestation.bundle; });
  // One verified proof per subject is sufficient. Persist its exact bytes before
  // draft creation so later API ordering or extra proofs cannot alter recovery.
  return bundles.sort((left, right) => sha256(JSON.stringify(left)).localeCompare(sha256(JSON.stringify(right)))).slice(0, 1);
}
function buildRecord(a) {
  const ref = `refs/tags/h02-python-build/v${a.version}`;
  const refs = pages(`git/matching-refs/tags/h02-python-build/v${a.version}`).filter((r) => r.ref === ref);
  assert.ok(refs.length <= 1, "Duplicate build record");
  if (!refs.length) return null;
  assert.equal(refs[0].object.type, "tag");
  const tag = api(`git/tags/${refs[0].object.sha}`);
  assert.equal(tag.object.sha, a.sha); assert.equal(tag.object.type, "commit");
  const record = JSON.parse(tag.message);
  exactKeys(record, "schemaVersion allocationSha256 receiptSha256 artifacts provenance");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.allocationSha256, sha256(JSON.stringify(a)));
  assert.match(record.receiptSha256, /^[a-f0-9]{64}$/);
  const p = record.provenance;
  exactKeys(p, "schemaVersion artifactId artifactDigest runAttempt builderJobId files");
  assert.equal(p.schemaVersion, 1); positive(p.artifactId); positive(p.runAttempt); positive(p.builderJobId);
  assert.match(p.artifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(BigInt(p.runAttempt) >= BigInt(a.allocationAttempt));
  assert.ok(Array.isArray(record.artifacts) && record.artifacts.length === a.wheelTags.length + 1);
  assert.ok(Array.isArray(p.files) && p.files.length === record.artifacts.length + 1);
  return record;
}
function jobsAt(a, attempt) {
  const rows = pages(`actions/runs/${a.runId}/attempts/${attempt}/jobs?per_page=100`).flatMap((page) => page.jobs ?? []);
  const event = { runId: a.runId, sha: a.sha, runAttempt: attempt };
  const found = (name) => {
    const selected = rows.filter((r) => r.name === name);
    assert.equal(selected.length, 1, "Missing or ambiguous original job");
    validateJob(selected[0], name, event);
    return selected[0];
  };
  found(a.gate);
  return found(a.builderJob);
}
function verifySavedProvenance(p, files, contents, directory, a) {
  assert.deepEqual(p.files.map(({ name, sha256 }) => ({ name, sha256 })), files.map(({ name, sha256 }) => ({ name, sha256 })));
  for (const file of p.files) {
    exactKeys(file, "name sha256 bundles");
    assert.ok(Array.isArray(file.bundles) && file.bundles.length > 0 && file.bundles.length <= 30);
    const bundle = join(directory, "verify-bundle.jsonl");
    writeFileSync(bundle, file.bundles.map((b) => JSON.stringify(b)).join("\n") + "\n");
    attest(join(contents, file.name), file, a, p.runAttempt, bundle);
  }
}
export function validateArtifact(artifact, a, event, builder) {
  assert.equal(artifact.expired, false);
  assert.equal(artifact.name, `h02-python-${event.runId}-${event.runAttempt}`);
  assert.equal(String(artifact.workflow_run.id), event.runId);
  assert.equal(artifact.workflow_run.head_sha, event.sha);
  assert.equal(artifact.workflow_run.head_branch, event.branch);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 256 * 1024 * 1024);
  assert.ok(Date.parse(artifact.created_at) >= Date.parse(builder.started_at) && Date.parse(artifact.created_at) <= Date.parse(builder.completed_at), "Artifact outside authorized builder job");
}
const verifyNative = (a, directory, allocationPath, sourcePath) => JSON.parse(execute("python3", ["-I", join(here, "python_artifacts.py"), "verify", "--allocation", allocationPath, "--directory", directory, "--source-pyproject", sourcePath, "--version-target", a.versionTarget]));
export function verifyBuild(c = pythonConfiguration()) {
  const a = JSON.parse(process.env.RELEASE_ALLOCATION);
  const { event } = context(c, "verify");
  recorded(a, event, c);
  const existing = pages("releases?per_page=100").filter((r) => r.tag_name === `v${a.version}`);
  assert.ok(existing.length <= 1);
  if (existing[0] && !existing[0].draft) {
    verifyPythonRelease(a, existing[0], c);
    return { allocation: a, event, completed: existing[0].html_url };
  }
  const saved = buildRecord(a);
  const buildAttempt = saved?.provenance.runAttempt ?? event.runAttempt;
  assert.ok(BigInt(buildAttempt) <= BigInt(event.runAttempt));
  const builder = jobsAt(a, buildAttempt);
  const id = process.env.RELEASE_ARTIFACT_ID; positive(id);
  if (saved) assert.equal(id, saved.provenance.artifactId, "Use the original verified build artifact");
  const artifact = api(`actions/artifacts/${id}`);
  assert.equal(String(artifact.id), id);
  validateArtifact(artifact, a, { ...event, runAttempt: buildAttempt }, builder);
  if (saved) assert.equal(artifact.digest, saved.provenance.artifactDigest);
  const directory = mkdtempSync(join(tmpdir(), "h02-python-"));
  const archive = execFileSync("gh", ["api", "--hostname", "github.com", `repos/${c.repository}/actions/artifacts/${id}/zip`], { maxBuffer: 256 * 1024 * 1024 });
  assert.equal(`sha256:${sha256(archive)}`, artifact.digest, "GitHub artifact archive digest mismatch");
  const archivePath = join(directory, "artifact.zip"); writeFileSync(archivePath, archive);
  const contents = join(directory, "contents");
  execute("python3", ["-I", join(here, "python_artifacts.py"), "extract", "--archive", archivePath, "--directory", contents]);
  const allocationPath = join(directory, "allocation.json"); writeFileSync(allocationPath, json(a));
  const files = verifyNative(a, contents, allocationPath, sourcePyproject(c, a.sha, directory));
  const receiptPath = join(contents, "python-build-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  validateReceipt(receipt, a, { ...event, runAttempt: buildAttempt }, builder, files);
  const receiptFile = { name: "python-build-receipt.json", sha256: sha256(readFileSync(receiptPath)) };
  const provenance = saved?.provenance ?? { schemaVersion: 1, artifactId: id, artifactDigest: artifact.digest, runAttempt: buildAttempt, builderJobId: String(builder.id), files: [...files, receiptFile].map((file) => ({ name: file.name, sha256: file.sha256, bundles: attest(join(contents, file.name), file, a, buildAttempt) })) };
  if (saved) {
    assert.deepEqual(files, saved.artifacts); assert.equal(receiptFile.sha256, saved.receiptSha256);
    verifySavedProvenance(provenance, [...files, receiptFile], contents, directory, a);
  }
  writeFileSync(join(directory, "provenance.json"), json(provenance));
  const manifest = { schemaVersion: 2, allocation: a, allocationSha256: sha256(JSON.stringify(a)), artifactId: id, artifactDigest: artifact.digest, runAttempt: buildAttempt, builderJobId: String(builder.id), artifacts: files, receiptSha256: receiptFile.sha256, provenanceSha256: sha256(readFileSync(join(directory, "provenance.json"))) };
  writeFileSync(join(directory, "release-manifest.json"), json(manifest));
  const assets = [...files.map((file) => join(contents, file.name)), receiptPath, join(directory, "provenance.json"), join(directory, "release-manifest.json")];
  writeFileSync(join(directory, "checksums.sha256"), assets.map((path) => `${sha256(readFileSync(path))}  ${basename(path)}\n`).join(""));
  assets.push(join(directory, "checksums.sha256"));
  const record = { schemaVersion: 1, allocationSha256: manifest.allocationSha256, receiptSha256: receiptFile.sha256, artifacts: files, provenance };
  return { allocation: a, event, directory, assets, record };
}
// Read-only, full-byte verification; also works after Actions artifact expiry.
// Source job records still need to exist in the Actions retention window.
export function verifyPythonRelease(a, release, c = pythonConfiguration()) {
  const event = { runId: a.runId, branch: a.branch, sha: a.sha, eventCreatedAt: a.eventCreatedAt };
  const run = api(`actions/runs/${a.runId}`);
  validateRun(run, { ...event, runAttempt: String(run.run_attempt) }, c, "verify");
  assert.equal(run.created_at, a.eventCreatedAt);
  recorded(a, event, c);
  assert.equal(release.body?.trim(), JSON.stringify(a, null, 2));
  assert.equal(release.draft, false); assert.equal(release.prerelease, a.branch === "dev");
  assert.equal(release.tag_name, `v${a.version}`);
  const saved = buildRecord(a); assert.ok(saved, "Missing immutable verified build record");
  const p = saved.provenance;
  const builder = jobsAt(a, p.runAttempt);
  assert.equal(String(builder.id), p.builderJobId);
  const directory = mkdtempSync(join(tmpdir(), "h02-python-audit-"));
  const contents = join(directory, "contents"); mkdirSync(contents);
  const names = [...saved.artifacts.map((f) => f.name), "python-build-receipt.json", "provenance.json", "release-manifest.json", "checksums.sha256"];
  assert.deepEqual(release.assets.map((f) => f.name).sort(), [...names].sort(), "Missing/extra/ambiguous Python release asset");
  let total = 0;
  const bytes = new Map();
  for (const name of names) {
    assert.match(name, /^[A-Za-z0-9_.+-]+$/);
    const asset = release.assets.find((f) => f.name === name);
    positive(String(asset.id)); assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
    const limit = /\.(whl|tar\.gz)$/.test(name) ? 256 * 1024 * 1024 : 8 * 1024 * 1024;
    assert.ok(asset.size > 0 && asset.size <= limit);
    const raw = execFileSync("gh", ["api", "--hostname", "github.com", `repos/${a.repository}/releases/assets/${asset.id}`, "--header", "Accept: application/octet-stream"], { maxBuffer: limit });
    total += raw.length; assert.ok(total <= 1024 * 1024 * 1024);
    assert.equal(`sha256:${sha256(raw)}`, asset.digest, "Downloaded release asset digest conflict");
    bytes.set(name, raw);
    writeFileSync(join(name.endsWith(".whl") || name.endsWith(".tar.gz") || name === "python-build-receipt.json" ? contents : directory, name), raw);
  }
  const manifest = JSON.parse(bytes.get("release-manifest.json"));
  exactKeys(manifest, "schemaVersion allocation allocationSha256 artifactId artifactDigest runAttempt builderJobId artifacts receiptSha256 provenanceSha256");
  assert.deepEqual(manifest, { schemaVersion: 2, allocation: a, allocationSha256: saved.allocationSha256, artifactId: p.artifactId, artifactDigest: p.artifactDigest, runAttempt: p.runAttempt, builderJobId: p.builderJobId, artifacts: saved.artifacts, receiptSha256: saved.receiptSha256, provenanceSha256: sha256(bytes.get("provenance.json")) });
  assert.deepEqual(JSON.parse(bytes.get("provenance.json")), p);
  assert.equal(sha256(bytes.get("python-build-receipt.json")), saved.receiptSha256);
  const allocationPath = join(directory, "allocation.json"); writeFileSync(allocationPath, json(a));
  const files = verifyNative(a, contents, allocationPath, sourcePyproject(c, a.sha, directory));
  assert.deepEqual(files, saved.artifacts);
  validateReceipt(JSON.parse(bytes.get("python-build-receipt.json")), a, { ...event, runAttempt: p.runAttempt }, builder, files);
  verifySavedProvenance(p, [...files, { name: "python-build-receipt.json", sha256: saved.receiptSha256 }], contents, directory, a);
  assert.equal(bytes.get("checksums.sha256").toString(), names.filter((n) => n !== "checksums.sha256").map((n) => `${sha256(bytes.get(n))}  ${n}\n`).join(""));
  return true;
}
export function reconcilePython(since, c = pythonConfiguration()) {
  assert.ok(since && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since) && Number.isFinite(Date.parse(since)), "Provide actual bootstrap UTC timestamp");
  const runs = pages(`actions/workflows/${c.workflow.split("/").at(-1)}/runs?event=push&per_page=100`).flatMap((page) => page.workflow_runs ?? []);
  const records = allocations();
  const releases = pages("releases?per_page=100");
  let missing = 0;
  for (const run of runs.filter((r) => ["dev", "main"].includes(r.head_branch) && r.created_at >= since)) {
    let state = "BLOCKED"; let reason;
    try {
      const matching = records.filter((r) => r.allocation?.runId === String(run.id));
      assert.ok(matching.length <= 1, "Duplicate original allocation");
      const a = matching[0]?.allocation;
      if (!a) {
        state = "ALLOCATION_OR_PREFLIGHT_REQUIRED";
      } else {
        const event = { runId: String(run.id), branch: run.head_branch, sha: run.head_sha, eventCreatedAt: run.created_at };
        validateEvent(run, event, c);
        validatePythonAllocation(a, event, matching[0].target, c);
        const found = releases.filter((r) => r.tag_name === `v${a.version}`);
        assert.ok(found.length <= 1, "Duplicate release identity");
        if (found[0] && !found[0].draft) {
          verifyPythonRelease(a, found[0], c);
          state = "READY";
        } else {
          const build = buildRecord(a);
          if (found[0]) {
            assert.equal(found[0].body?.trim(), JSON.stringify(a, null, 2));
            assert.equal(found[0].prerelease, a.branch === "dev");
            assert.ok(build, "Draft without immutable build identity");
          }
          state = build ? "RECOVER_ORIGINAL_BUILD" : "BUILD_REQUIRED";
        }
      }
    } catch (error) { reason = error.message; }
    if (state !== "READY") missing++;
    console.log(JSON.stringify({ runId: String(run.id), sha: run.head_sha, branch: run.head_branch, state, reason, recovery: state === "READY" ? null : `gh run rerun ${run.id} --repo ${c.repository}` }));
  }
  return missing;
}
export function publishPython(c = pythonConfiguration()) {
  const checked = verifyBuild(c);
  if (checked.completed) { console.log(checked.completed); return; }
  const { allocation: a, event, directory, assets } = checked;
  if (!buildRecord(a)) {
    const tag = `h02-python-build/v${a.version}`;
    const object = api("git/tags", { tag, message: JSON.stringify(checked.record), object: a.sha, type: "commit" });
    api("git/refs", { ref: `refs/tags/${tag}`, sha: object.sha });
  }
  const tag = `v${a.version}`;
  const releases = pages("releases?per_page=100");
  const matches = releases.filter((r) => r.tag_name === tag);
  assert.ok(matches.length <= 1);
  const existing = matches[0];
  const notes = JSON.stringify(a, null, 2);
  if (existing) {
    assert.equal(existing.body?.trim(), notes, "Existing release identity conflict");
    assert.equal(existing.prerelease, event.branch === "dev", "Existing channel conflict");
    const expectedNames = assets.map((path) => basename(path)).sort();
    assert.equal(new Set(existing.assets.map((f) => f.name)).size, existing.assets.length);
    assert.ok(existing.assets.every((f) => expectedNames.includes(f.name)), "Unexpected published asset");
  } else {
    const notesPath = join(directory, "notes.txt"); writeFileSync(notesPath, notes);
    const args = ["release", "create", tag, "--repo", c.repository, "--verify-tag", "--target", event.sha, "--title", tag, "--notes-file", notesPath, "--draft"];
    if (event.branch === "dev") args.push("--prerelease");
    execute("gh", args);
  }
  const release = gh(["release", "view", tag, "--repo", c.repository, "--json", "assets,isDraft"]);
  // Preflight every present asset before uploading any missing asset.
  for (const asset of release.assets) {
    const path = assets.find((file) => basename(file) === asset.name);
    assert.ok(path, "Unexpected release asset");
    assert.equal(asset.digest, `sha256:${sha256(readFileSync(path))}`, "Existing asset conflict: BLOCKED");
  }
  for (const path of assets) if (!release.assets.some((f) => f.name === basename(path))) {
    assert.equal(release.isDraft, true, "Published release missing assets: BLOCKED");
    execute("gh", ["release", "upload", tag, path, "--repo", c.repository]);
  }
  // A completed event is immutable, even when rerun after a newer attempt. Never
  // edit published assets/body or reselect latest for an already-published event.
  if (release.isDraft) execute("gh", ["release", "edit", tag, "--repo", c.repository, "--draft=false", `--latest=${shouldBeLatest(a, releases)}`]);
  const final = gh(["release", "view", tag, "--repo", c.repository, "--json", "url,isDraft,isPrerelease,assets"]);
  assert.equal(final.isDraft, false); assert.equal(final.isPrerelease, a.branch === "dev");
  assert.deepEqual(final.assets.map((f) => f.name).sort(), assets.map((path) => basename(path)).sort());
  for (const path of assets) assert.equal(final.assets.find((f) => f.name === basename(path)).digest, `sha256:${sha256(readFileSync(path))}`);
  recorded(a, event, c);
  verifyPythonRelease(a, pages("releases?per_page=100").find((r) => r.tag_name === tag), c);
  console.log(final.url);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "allocate") console.log(JSON.stringify(allocatePython()));
  else if (mode === "verify") { verifyBuild(); console.log("Verified exact Python build, receipt and signed provenance"); }
  else if (mode === "publish") publishPython();
  else throw new Error("Expected allocate, verify or publish");
}
