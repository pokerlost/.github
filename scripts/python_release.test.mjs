import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { pythonConfiguration, pythonVersion, sha256, validateArtifact, validateJob, validatePythonAllocation, validatePythonConfiguration, validateReceipt, validateRun, verifyAttestationResults } from "./python_release.mjs";

const repository = "pokerlost/.github";
const providerRef = "b".repeat(40);
const configuration = () => ({ repository, adapter: "python", workflow: ".github/workflows/ci.yml", gate: "preflight", bundleName: "h02-demo", providerRef, contractSchema: "h02-python/v1", builderJob: "native-build", versionTarget: "1.2.3", wheelTags: ["py3-none-any"] });
const event = () => ({ runId: "123", runAttempt: "1", sha: "a".repeat(40), branch: "dev", eventCreatedAt: "2026-11-14T00:00:00Z" });
const allocation = () => ({ ...configuration(), schemaVersion: 2, ...event(), version: "1.2.3-dev.0", allocationAttempt: "1", pythonVersion: "1.2.3.dev0" });
function nativeAllocation() { const { runAttempt, ...value } = allocation(); return value; }
function runRecord() {
  const e = event();
  return { id: Number(e.runId), run_attempt: 1, repository: { full_name: repository }, event: "push", path: configuration().workflow, head_branch: e.branch, head_sha: e.sha, created_at: e.eventCreatedAt, referenced_workflows: ["python-allocate.yml", "python-publish.yml"].map((name) => ({ path: `pokerlost/.github/.github/workflows/${name}@${providerRef}`, sha: providerRef })) };
}
function jobRecord() { return { id: 102, name: "native-build", run_id: 123, run_attempt: 1, head_sha: event().sha, conclusion: "success", started_at: "2026-11-14T00:01:00Z", completed_at: "2026-11-14T00:10:00Z" }; }
function attestation(file = { name: "demo.whl", sha256: "c".repeat(64) }) {
  const a = nativeAllocation();
  const invocationId = `https://github.com/${repository}/actions/runs/123/attempts/1`;
  return [{ attestation: { bundle: { fixtureOnly: true } }, verificationResult: { signature: { certificate: { runInvocationURI: invocationId, sourceRepositoryURI: `https://github.com/${repository}`, sourceRepositoryDigest: a.sha, sourceRepositoryRef: "refs/heads/dev", buildSignerURI: `https://github.com/${repository}/${a.workflow}@refs/heads/dev`, buildSignerDigest: a.sha } }, verifiedTimestamps: [{ type: "fixture-only" }], statement: { predicateType: "https://slsa.dev/provenance/v1", subject: [{ name: file.name, digest: { sha256: file.sha256 } }], predicate: { runDetails: { metadata: { invocationId } } } } } }];
}

test("Python allocation maps exact SemVer to canonical PEP 440, numerically", () => {
  for (const [input, expected] of [["1.2.3-dev.0", "1.2.3.dev0"], ["v1.2.3-dev.10", "1.2.3.dev10"], ["1.2.3", "1.2.3"], ["v1.2.3", "1.2.3"]]) assert.equal(pythonVersion(input), expected);
  for (const input of ["1.2", "1.2.3.dev10", "1.2.3-dev.01", "01.2.3", "1.2.3-rc.1", "1.2.3+local", "1.2.9007199254740992"]) assert.throws(() => pythonVersion(input));
});
test("Python configuration rejects unsupported schema, commands and ambiguous variants", () => {
  validatePythonConfiguration(configuration());
  for (const change of [{ contractSchema: "h02-python/v2" }, { adapter: "shell" }, { repository: "../other/repo" }, { workflow: "../../script" }, { gate: "$(false)" }, { builderJob: "preflight" }, { bundleName: "wrong_Name" }, { providerRef: "main" }, { versionTarget: "v1.2.3" }, { wheelTags: [] }, { wheelTags: ["py3-none-any", "py3-none-any"] }, { wheelTags: ["py2.py3-none-any"] }, { wheelTags: ["py3-none-any", "cp312-cp312-linux_x86_64"] }]) assert.throws(() => validatePythonConfiguration({ ...configuration(), ...change }), JSON.stringify(change));
  const env = { GITHUB_REPOSITORY: repository, RELEASE_SCHEMA: "h02-python/v1", RELEASE_WORKFLOW: ".github/workflows/ci.yml", RELEASE_GATE: "preflight", RELEASE_BUILDER: "native-build", RELEASE_BUNDLE_NAME: "h02-demo", RELEASE_PROVIDER_REF: providerRef, RELEASE_VERSION_TARGET: "1.2.3", RELEASE_WHEEL_TAGS: '["py3-none-any"]' };
  assert.deepEqual(pythonConfiguration(env), configuration());
  assert.throws(() => pythonConfiguration({ ...env, RELEASE_WHEEL_TAGS: "not-json" }));
});
test("immutable Python allocation rejects identity, version target, channel and attempt conflicts", () => {
  const a = nativeAllocation();
  validatePythonAllocation(a, event(), a.sha, configuration());
  validatePythonAllocation(a, { ...event(), runAttempt: "2" }, a.sha, configuration());
  for (const change of [{ repository: "another/repo" }, { runId: "124" }, { sha: "d".repeat(40) }, { branch: "main" }, { eventCreatedAt: "2026-11-14T01:00:00Z" }, { versionTarget: "1.2.4" }, { providerRef: "e".repeat(40) }, { pythonVersion: "1.2.3.dev1" }, { version: "1.2.3" }, { schemaVersion: 1 }, { allocationAttempt: "2" }, { arbitrary: true }]) assert.throws(() => validatePythonAllocation({ ...a, ...change }, event(), a.sha, configuration()), JSON.stringify(change));
  assert.throws(() => validatePythonAllocation(a, event(), "f".repeat(40), configuration()));
});
test("original run, immutable provider pin, exact successful job and artifact attempt are enforced", () => {
  validateRun(runRecord(), event(), configuration(), "verify");
  for (const change of [{ id: 124 }, { event: "pull_request" }, { head_sha: "c".repeat(40) }, { head_branch: "main" }, { path: ".github/workflows/other.yml" }, { run_attempt: 2 }, { repository: { full_name: "other/repo" } }, { referenced_workflows: [] }]) assert.throws(() => validateRun({ ...runRecord(), ...change }, event(), configuration(), "verify"), JSON.stringify(change));
  const job = jobRecord(); validateJob(job, "native-build", event());
  for (const change of [{ conclusion: "failure" }, { conclusion: "skipped" }, { name: "wrong-job" }, { run_id: 124 }, { run_attempt: 2 }, { head_sha: "d".repeat(40) }]) assert.throws(() => validateJob({ ...job, ...change }, "native-build", event()));
  const artifact = { id: 55, expired: false, name: "h02-python-123-1", digest: `sha256:${"c".repeat(64)}`, size_in_bytes: 100, workflow_run: { id: 123, head_sha: event().sha, head_branch: "dev" }, created_at: "2026-11-14T00:05:00Z" };
  validateArtifact(artifact, nativeAllocation(), event(), job);
  for (const change of [{ expired: true }, { name: "h02-python-123-2" }, { digest: "sha256:wrong" }, { created_at: "2026-11-14T01:00:00Z" }, { size_in_bytes: 300 * 1024 * 1024 }, { workflow_run: { ...artifact.workflow_run, id: 124 } }, { workflow_run: { ...artifact.workflow_run, head_sha: "c".repeat(40) } }]) assert.throws(() => validateArtifact({ ...artifact, ...change }, nativeAllocation(), event(), job));
});
test("native build receipt binds exact metadata, checksums, tool and job identity", () => {
  const a = nativeAllocation(); const files = [{ name: "demo.whl", sha256: "c".repeat(64), version: a.pythonVersion }, { name: "demo.tar.gz", sha256: "d".repeat(64), version: a.pythonVersion, buildBackend: "setuptools.build_meta" }];
  const receipt = { schemaVersion: 1, allocationSha256: sha256(JSON.stringify(a)), runId: "123", runAttempt: "1", sourceSha: a.sha, builderJob: a.builderJob, builderJobId: "102", buildTool: { backend: "setuptools.build_meta", backendVersion: "80.9.0", frontend: "build", frontendVersion: "1.3.0", versionInjection: "static project.version" }, files };
  validateReceipt(receipt, a, event(), jobRecord(), files);
  for (const change of [{ schemaVersion: 2 }, { allocationSha256: "d".repeat(64) }, { runId: "124" }, { runAttempt: "2" }, { sourceSha: "e".repeat(40) }, { builderJobId: "103" }, { builderJob: "untrusted" }, { files: [] }, { buildTool: { ...receipt.buildTool, versionInjection: "" } }, { buildTool: { ...receipt.buildTool, frontend: "$(false)" } }]) assert.throws(() => validateReceipt({ ...receipt, ...change }, a, event(), jobRecord(), files));
});
test("attestation policy requires certificate source/signer/run/attempt and exact subject", () => {
  const a = nativeAllocation(); const file = { name: "demo.whl", sha256: "c".repeat(64) };
  verifyAttestationResults(attestation(file), file, a, "1");
  assert.throws(() => verifyAttestationResults([], file, a, "1"));
  for (const [key, value] of [["runInvocationURI", "https://github.com/pokerlost/.github/actions/runs/123/attempts/2"], ["sourceRepositoryURI", "https://github.com/other/repo"], ["sourceRepositoryDigest", "d".repeat(40)], ["sourceRepositoryRef", "refs/heads/main"], ["buildSignerURI", "https://github.com/other/repo/build.yml@refs/heads/dev"], ["buildSignerDigest", "e".repeat(40)]]) {
    const rows = attestation(file); rows[0].verificationResult.signature.certificate[key] = value;
    assert.throws(() => verifyAttestationResults(rows, file, a, "1"), key);
  }
  for (const mutation of [(r) => { r.verifiedTimestamps = []; }, (r) => { r.statement.predicateType = "https://example.invalid/unsigned"; }, (r) => { r.statement.subject[0].digest.sha256 = "d".repeat(64); }, (r) => { r.statement.subject[0].name = "another.whl"; }, (r) => { r.statement.predicate.runDetails.metadata.invocationId += "0"; }]) {
    const rows = attestation(file); mutation(rows[0].verificationResult); assert.throws(() => verifyAttestationResults(rows, file, a, "1"));
  }
});

function integration(branch) {
  const root = mkdtempSync(join(tmpdir(), "h02-protocol-")); const statePath = join(root, "state.json");
  mkdirSync(join(root, "bin"));
  const stub = resolve("scripts/fixtures/gh-python-release.mjs");
  const gh = join(root, "bin", "gh");
  writeFileSync(gh, `#!/bin/sh\nexec '${process.execPath}' '${stub}' "$@"\n`); chmodSync(gh, 0o755);
  const pyproject = '[build-system]\nrequires = ["setuptools", "wheel"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "h02-demo"\nversion = "1.2.3.dev10"\nrequires-python = ">=3.12"\n';
  const initial = { repository, workflow: ".github/workflows/ci.yml", providerRef, pyproject, event: { ...event(), branch }, refs: [], tags: {}, releases: [], jobsByAttempt: { "1": [{ ...jobRecord(), id: 101, name: "preflight" }, jobRecord()] } };
  const save = (value) => writeFileSync(statePath, JSON.stringify(value)); const read = () => JSON.parse(readFileSync(statePath, "utf8")); save(initial);
  const run = (mode, extras = {}) => {
    const current = read();
    const arguments_ = mode === "reconcile" ? ["--input-type=module", "-e", `import {reconcilePython} from ${JSON.stringify(pathToFileURL(resolve("scripts/python_release.mjs")).href)}; process.exitCode = reconcilePython("2026-11-14T00:00:00Z") ? 1 : 0;`] : [resolve("scripts/python_release.mjs"), mode];
    return spawnSync(process.execPath, arguments_, { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, RELEASE_FIXTURE_STATE: statePath, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: current.event.runId, GITHUB_RUN_ATTEMPT: current.event.runAttempt, GITHUB_REF_NAME: current.event.branch, GITHUB_SHA: current.event.sha, RELEASE_ADAPTER: "python", RELEASE_SCHEMA: "h02-python/v1", RELEASE_PROVIDER_REF: providerRef, RELEASE_WORKFLOW: current.workflow, RELEASE_GATE: "preflight", RELEASE_BUILDER: "native-build", RELEASE_BUNDLE_NAME: "h02-demo", RELEASE_VERSION_TARGET: "1.2.3", RELEASE_WHEEL_TAGS: '["py3-none-any"]', RELEASE_ALLOCATION: current.allocation ? JSON.stringify(current.allocation) : "", RELEASE_ARTIFACT_ID: "55", ...extras } });
  };
  const allocate = () => {
    const result = run("allocate"); assert.equal(result.status, 0, result.stderr);
    const outputs = JSON.parse(result.stdout); const current = read(); current.allocation = JSON.parse(outputs.allocation); save(current); return outputs;
  };
  const build = () => {
    const current = read(); const a = current.allocation; const source = join(root, "source"); mkdirSync(source);
    mkdirSync(join(source, "h02_demo")); writeFileSync(join(source, "h02_demo", "__init__.py"), "ANSWER = 42\n");
    writeFileSync(join(source, "pyproject.toml"), `[build-system]\nrequires = ["setuptools", "wheel"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "h02-demo"\nversion = "${a.pythonVersion}"\nrequires-python = ">=3.12"\n`);
    writeFileSync(join(source, "setup.py"), "from setuptools import setup\nsetup()\n"); writeFileSync(join(source, "README.md"), "Real protocol fixture.\n");
    const cleanEnv = { ...process.env }; delete cleanEnv.GH_TOKEN; delete cleanEnv.GITHUB_TOKEN; delete cleanEnv.PYTHONPATH;
    execFileSync("python3", ["setup.py", "--quiet", "sdist", "bdist_wheel"], { cwd: source, stdio: "pipe", env: cleanEnv });
    const dist = join(source, "dist"); const aPath = join(root, "allocation.json"); writeFileSync(aPath, JSON.stringify(a));
    const files = JSON.parse(execFileSync("python3", ["-I", resolve("scripts/python_artifacts.py"), "verify", "--allocation", aPath, "--directory", dist], { encoding: "utf8" }));
    const receipt = { schemaVersion: 1, allocationSha256: sha256(JSON.stringify(a)), runId: current.event.runId, runAttempt: current.event.runAttempt, sourceSha: current.event.sha, builderJob: a.builderJob, builderJobId: "102", buildTool: { backend: "setuptools.build_meta", backendVersion: "fixture-installed", frontend: "setuptools", frontendVersion: "fixture-installed", versionInjection: "static project.version in isolated fixture" }, files };
    writeFileSync(join(dist, "python-build-receipt.json"), JSON.stringify(receipt));
    const archivePath = join(root, "artifact.zip");
    execFileSync("python3", ["-c", "import sys,zipfile; from pathlib import Path; p=Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); [(z.write(f,f.name)) for f in sorted(p.iterdir())]; z.close()", dist, archivePath]);
    const raw = readFileSync(archivePath);
    current.artifacts = { "55": { id: 55, expired: false, name: `h02-python-${current.event.runId}-${current.event.runAttempt}`, digest: `sha256:${sha256(raw)}`, size_in_bytes: raw.length, workflow_run: { id: Number(current.event.runId), head_sha: current.event.sha, head_branch: current.event.branch }, created_at: "2026-11-14T00:05:00Z", archivePath } };
    current.artifactAttempt = current.event.runAttempt; save(current);
  };
  return { root, read, save, run, allocate, build, close: () => rmSync(root, { recursive: true, force: true }) };
}

for (const branch of ["dev", "main"]) test(`Python ${branch}: original allocation, missing build, verified bytes, partial draft and retry`, () => {
  const f = integration(branch);
  try {
    const failed = f.read(); failed.jobsByAttempt["1"][0].conclusion = "failure"; f.save(failed);
    let result = f.run("allocate"); assert.notEqual(result.status, 0); assert.equal(f.read().refs.length, 0);
    failed.jobsByAttempt["1"][0].conclusion = "success"; f.save(failed);
    const first = f.allocate(); const a = f.read().allocation;
    assert.equal(first["python-version"], branch === "dev" ? "1.2.3.dev0" : "1.2.3");
    assert.equal(f.read().refs.length, 1);
    result = f.run("publish"); assert.notEqual(result.status, 0); assert.equal(f.read().releases.length, 0);
    assert.equal(f.allocate().allocation, first.allocation); assert.equal(f.read().refs.length, 1);
    f.build(); result = f.run("verify"); assert.equal(result.status, 0, result.stderr);
    const partial = f.read(); partial.failAfterAsset = true; f.save(partial);
    result = f.run("publish"); assert.notEqual(result.status, 0); assert.match(result.stderr, /Injected asset interruption/);
    assert.equal(f.read().releases[0].draft, true); assert.equal(f.read().releases[0].assets.length, 1);
    result = f.run("publish"); assert.equal(result.status, 0, result.stderr);
    const complete = f.read(); const published = complete.releases[0];
    assert.equal(published.draft, false); assert.equal(published.prerelease, branch === "dev"); assert.equal(complete.latest, branch === "main");
    assert.deepEqual(published.assets.map((asset) => asset.name).sort(), [`h02_demo-${a.pythonVersion}-py3-none-any.whl`, `h02_demo-${a.pythonVersion}.tar.gz`, "python-build-receipt.json", "provenance.json", "release-manifest.json", "checksums.sha256"].sort());
    result = f.run("publish"); assert.equal(result.status, 0, result.stderr); assert.deepEqual(f.read().releases, complete.releases); assert.equal(f.read().edits, complete.edits);
    // A full original-run rerun preserves published bytes even after the temporary
    // Actions artifact expires; signed Release assets remain independently audited.
    const rerun = f.read(); rerun.event.runAttempt = "2"; rerun.jobsByAttempt["2"] = [{ ...jobRecord(), id: 201, name: "preflight", run_attempt: 2 }]; rerun.artifacts = {}; f.save(rerun);
    const reused = f.allocate(); assert.equal(reused.allocation, first.allocation); assert.equal(reused["build-required"], "false"); assert.equal(reused["artifact-id"], "55");
    result = f.run("publish"); assert.equal(result.status, 0, result.stderr); assert.deepEqual(f.read().releases, complete.releases); assert.equal(f.read().edits, complete.edits);
    result = f.run("reconcile"); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"state":"READY"/);
    const conflict = f.read(); conflict.releases[0].assets[0].digest = `sha256:${"0".repeat(64)}`; f.save(conflict);
    result = f.run("publish"); assert.notEqual(result.status, 0); assert.equal(f.read().edits, complete.edits);
  } finally { f.close(); }
});
test("interrupted verified build recovers its original attempt and older stable never becomes latest", () => {
  const f = integration("main");
  try {
    const first = f.allocate(); f.build();
    const original = f.read(); original.failCreate = true; f.save(original);
    let result = f.run("publish"); assert.notEqual(result.status, 0); assert.match(result.stderr, /Injected failure after verified build record/);
    assert.equal(f.read().releases.length, 0); assert.equal(f.read().refs.length, 2);
    const next = f.read(); next.event.runAttempt = "2"; next.jobsByAttempt["2"] = [{ ...jobRecord(), id: 201, name: "preflight", run_attempt: 2 }];
    next.releases.push({ tag_name: "v1.2.4", draft: false, prerelease: false, body: JSON.stringify({ runId: "124", eventCreatedAt: "2026-11-14T01:00:00Z" }), assets: [], html_url: "https://github.com/fixture/newer" }); f.save(next);
    const reused = f.allocate(); assert.equal(reused.allocation, first.allocation); assert.equal(reused["build-required"], "false"); assert.equal(reused["artifact-id"], "55");
    result = f.run("publish"); assert.equal(result.status, 0, result.stderr); assert.equal(f.read().latest, false); assert.equal(f.read().refs.length, 2);
    const beforeAudit = f.read(); result = f.run("reconcile"); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"state":"READY"/); assert.deepEqual(f.read(), beforeAudit);
    const missing = f.read(); missing.releases.find((r) => r.tag_name === "v1.2.3").assets = missing.releases.find((r) => r.tag_name === "v1.2.3").assets.filter((a) => !a.name.endsWith(".whl")); f.save(missing);
    result = f.run("reconcile"); assert.equal(result.status, 1); assert.match(result.stdout, /"state":"BLOCKED"/); assert.doesNotMatch(result.stdout, /"state":"READY"/);
  } finally { f.close(); }
});
test("an unbuilt allocation survives a later full attempt without allocating another version", () => {
  const f = integration("dev");
  try {
    const first = f.allocate(); const second = f.read(); second.event.runAttempt = "2"; second.jobsByAttempt["2"] = [{ ...jobRecord(), name: "preflight", run_attempt: 2 }, { ...jobRecord(), run_attempt: 2 }]; f.save(second);
    const reused = f.allocate(); assert.equal(reused.allocation, first.allocation); assert.equal(reused["build-required"], "true"); assert.equal(f.read().refs.length, 1);
    f.build(); const result = f.run("publish"); assert.equal(result.status, 0, result.stderr); assert.equal(f.read().releases.length, 1); assert.equal(f.read().refs.length, 2);
  } finally { f.close(); }
});
test("Python publication fails closed for corrupt transport, native receipt and signed provenance policy", () => {
  const f = integration("dev");
  try {
    f.allocate(); f.build(); const good = f.read();
    for (const change of [(s) => { s.artifacts["55"].digest = `sha256:${"0".repeat(64)}`; }, (s) => { s.jobsByAttempt["1"][1].conclusion = "failure"; }, (s) => { s.attestationFailure = true; }, (s) => { s.certOverrides = { runInvocationURI: `https://github.com/${repository}/actions/runs/124/attempts/1` }; }, (s) => { s.runOverrides = { run_attempt: 2 }; }, (s) => { s.artifacts["55"].workflow_run.head_sha = "c".repeat(40); }]) {
      const current = structuredClone(good); change(current); f.save(current);
      const result = f.run("publish"); assert.notEqual(result.status, 0, result.stdout); assert.equal(f.read().releases.length, 0);
    }
    f.save(good); const conflicted = f.read(); const ref = conflicted.refs.find((row) => row.ref.startsWith("refs/tags/v")); conflicted.tags[ref.object.sha].object.sha = "c".repeat(40); f.save(conflicted);
    assert.notEqual(f.run("allocate").status, 0); assert.notEqual(f.run("publish").status, 0);
  } finally { f.close(); }
});
