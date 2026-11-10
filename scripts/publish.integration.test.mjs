import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

for (const adapter of ["version-file", "npm"]) for (const branch of ["dev", "main"]) test(`publisher ${adapter} ${branch}: failed gate, partial failure, retry and conflicts`, () => {
  const root = mkdtempSync(join(tmpdir(), "rules-publisher-"));
  const repo = join(root, "repo");
  const statePath = join(root, "state.json");
  try {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(root, "bin"));
    for (const file of ["publish.mjs"]) cpSync(resolve("scripts", file), join(repo, "scripts", file));
    const stub = resolve("scripts/fixtures/gh-release.mjs");
    const gh = join(root, "bin", "gh");
    writeFileSync(gh, `#!/bin/sh\nexec '${process.execPath}' '${stub}' "$@"\n`); chmodSync(gh, 0o755);
    writeFileSync(join(repo, "VERSION"), "1.2.3-dev.2\n");
    const pkg = { name: "fixture-rules", private: true, version: "1.2.3-dev.2", files: ["scripts/"], scripts: { prepare: "exit 99", prepack: "exit 99", build: "mkdir -p coverage/artifacts && npm pack --ignore-scripts --offline --pack-destination coverage/artifacts --json > coverage/pack.json && node scripts/release.mjs capture", verify: "node scripts/release.mjs verify" } };
    writeFileSync(join(repo, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { "": { name: pkg.name, version: pkg.version } } }));
    writeFileSync(join(repo, ".gitignore"), "coverage/\n");
    const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init", "-q"]); git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
    const event = { runId: "123", branch, sha: git(["rev-parse", "HEAD"]) };
    const save = (state) => writeFileSync(statePath, JSON.stringify(state));
    const read = () => JSON.parse(readFileSync(statePath, "utf8"));
    save({ event, gate: "failure", refs: [] });
    const run = () => spawnSync(process.execPath, ["scripts/publish.mjs"], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, RELEASE_FIXTURE_STATE: statePath, GITHUB_REPOSITORY: "pokerlost/.github", RELEASE_ADAPTER: adapter, GITHUB_RUN_ID: event.runId, GITHUB_REF_NAME: event.branch, GITHUB_SHA: event.sha } });
    assert.notEqual(run().status, 0); assert.equal(read().refs.length, 0);
    save({ ...read(), gate: "success", failAfterTag: true });
    let result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Injected failure/);
    assert.equal(read().refs.length, 1); assert.equal(read().release, undefined);
    save({ ...read(), failAfterAsset: true });
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Injected asset interruption/);
    assert.equal(read().release.draft, true); assert.equal(read().release.assets.length, 1);
    result = run(); assert.equal(result.status, 0, result.stderr);
    const released = read(); assert.equal(released.release.draft, false); assert.equal(released.latest, branch === "main"); assert.equal(released.release.prerelease, branch === "dev"); assert.equal(released.release.assets.length, 3);
    result = run(); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(read().release, released.release); assert.equal(read().refs.length, 1);
    save({ ...read(), tag: { ...read().tag, object: { sha: "c".repeat(40) } } });
    assert.notEqual(run().status, 0);
    save({ ...released, release: { ...released.release, assets: released.release.assets.map((asset, index) => index ? asset : { ...asset, digest: "sha256:incorrect" }) } });
    assert.notEqual(run().status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
