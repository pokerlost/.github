// Simulated GitHub boundary for protocol tests. Attestations here are deliberately
// synthetic; only hosted `gh attestation verify` can establish cryptographic trust.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const statePath = process.env.RELEASE_FIXTURE_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const save = () => writeFileSync(statePath, JSON.stringify(state));
const output = (value) => { save(); console.log(JSON.stringify(value)); };
const bytes = (value) => { save(); process.stdout.write(value); };
const fail = (message) => { save(); console.error(message); process.exit(1); };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const option = (name) => args[args.indexOf(name) + 1];
const payload = args.includes("--input") ? JSON.parse(readFileSync(0, "utf8")) : undefined;
const event = state.event;
const prefix = `repos/${state.repository}/`;
const endpoint = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const paged = (value) => output(args.includes("--slurp") ? [value] : value);
const release = () => state.releases.find((item) => item.tag_name === args[2]);

if (args[0] === "api") {
  if (endpoint?.startsWith("contents/pyproject.toml?ref=")) output({ type: "file", encoding: "base64", size: Buffer.byteLength(state.pyproject), content: Buffer.from(state.pyproject).toString("base64") });
  else if (endpoint?.startsWith("actions/workflows/") && endpoint.includes("/runs?")) {
    paged({ workflow_runs: [{ id: Number(event.runId), event: "push", path: state.workflow, head_branch: event.branch, head_sha: event.sha, created_at: event.eventCreatedAt, conclusion: "success" }] });
  } else if (endpoint === `actions/runs/${event.runId}` || endpoint === `actions/runs/${event.runId}/attempts/${event.runAttempt}`) {
    output({ id: Number(event.runId), event: "push", path: state.workflow, repository: { full_name: state.repository }, head_branch: event.branch, head_sha: event.sha, created_at: event.eventCreatedAt, run_attempt: Number(event.runAttempt), referenced_workflows: ["python-allocate.yml", "python-publish.yml"].map((name) => ({ path: `pokerlost/.github/.github/workflows/${name}@${state.providerRef}`, sha: state.providerRef })), ...state.runOverrides });
  } else if (endpoint?.match(/^actions\/runs\/\d+\/attempts\/\d+\/jobs\?/)) {
    const attempt = endpoint.match(/\/attempts\/(\d+)\//)[1];
    paged({ jobs: state.jobsByAttempt[attempt] ?? [] });
  } else if (endpoint?.startsWith("actions/artifacts/")) {
    const id = endpoint.split("/")[2];
    const artifact = state.artifacts?.[id];
    if (!artifact) fail("Artifact not found");
    if (endpoint.endsWith("/zip")) bytes(readFileSync(artifact.archivePath));
    else { const { archivePath, ...metadata } = artifact; output(metadata); }
  } else if (endpoint?.startsWith("git/matching-refs/")) {
    const matchPrefix = `refs/${endpoint.slice("git/matching-refs/".length)}`;
    paged(state.refs.filter((ref) => ref.ref.startsWith(matchPrefix)));
  } else if (endpoint?.startsWith("git/ref/")) {
    const ref = state.refs.find((item) => item.ref === `refs/${endpoint.slice("git/ref/".length)}`);
    if (!ref) fail("Ref not found");
    output(ref);
  } else if (endpoint === "git/tags" && payload) {
    const sha = digest(Buffer.from(JSON.stringify(payload))).slice(0, 40);
    state.tags[sha] = { sha, tag: payload.tag, message: payload.message, object: { sha: payload.object, type: "commit" } };
    output(state.tags[sha]);
  } else if (endpoint === "git/refs" && payload) {
    if (state.refs.some((item) => item.ref === payload.ref)) fail("Ref already exists");
    const ref = { ref: payload.ref, object: { sha: payload.sha, type: "tag" } };
    state.refs.push(ref); output(ref);
  } else if (endpoint?.startsWith("git/tags/")) {
    const tag = state.tags[endpoint.slice("git/tags/".length)];
    if (!tag) fail("Tag not found");
    output(tag);
  } else if (endpoint === "releases?per_page=100") paged(state.releases);
  else if (endpoint?.startsWith("releases/assets/")) {
    const id = endpoint.slice("releases/assets/".length);
    const asset = state.releases.flatMap((r) => r.assets).find((item) => String(item.id) === id);
    if (!asset) fail("Release asset not found");
    bytes(Buffer.from(asset.bytes, "base64"));
  } else if (endpoint?.startsWith("releases/tags/")) {
    const tag = endpoint.slice("releases/tags/".length);
    const found = state.releases.find((item) => item.tag_name === tag);
    if (!found) fail("Release not found");
    output(found);
  } else fail(`Unexpected API: ${endpoint}`);
} else if (args[0] === "attestation" && args[1] === "verify") {
  if (state.attestationFailure) fail("Injected unverified attestation");
  for (const flag of ["--repo", "--source-digest", "--source-ref", "--signer-workflow", "--signer-digest", "--predicate-type", "--format"]) if (!args.includes(flag)) fail(`Missing verification policy ${flag}`);
  if (!args.includes("--deny-self-hosted-runners")) fail("Missing runner trust policy");
  const path = args[2];
  const a = state.allocation;
  if (option("--repo") !== a.repository || option("--source-digest") !== a.sha || option("--source-ref") !== `refs/heads/${a.branch}` || option("--signer-workflow") !== `${a.repository}/${a.workflow}` || option("--signer-digest") !== a.sha) fail("Wrong attestation policy");
  const fileDigest = digest(readFileSync(path));
  const bundle = args.includes("--bundle") ? JSON.parse(readFileSync(option("--bundle"), "utf8").trim().split("\n")[0]) : { fixtureOnly: true, name: basename(path), sha256: fileDigest, runAttempt: state.artifactAttempt ?? event.runAttempt };
  if (bundle.sha256 !== fileDigest || bundle.name !== basename(path)) fail("Fixture bundle subject mismatch");
  const uri = `https://github.com/${a.repository}/actions/runs/${a.runId}/attempts/${bundle.runAttempt}`;
  const certificate = { runInvocationURI: uri, sourceRepositoryURI: `https://github.com/${a.repository}`, sourceRepositoryDigest: a.sha, sourceRepositoryRef: `refs/heads/${a.branch}`, buildSignerURI: `https://github.com/${a.repository}/${a.workflow}@refs/heads/${a.branch}`, buildSignerDigest: a.sha, ...state.certOverrides };
  output([{ attestation: { bundle }, verificationResult: { signature: { certificate }, verifiedTimestamps: [{ type: "fixture-only" }], statement: { predicateType: "https://slsa.dev/provenance/v1", subject: [{ name: basename(path), digest: { sha256: fileDigest } }], predicate: { runDetails: { metadata: { invocationId: uri } } }, ...state.statementOverrides } } }]);
} else if (args[0] === "release") {
  if (args[1] === "create") {
    if (state.failCreate) { state.failCreate = false; fail("Injected failure after verified build record"); }
    if (release()) fail("Release already exists");
    const result = { tag_name: args[2], body: readFileSync(option("--notes-file"), "utf8"), draft: true, prerelease: args.includes("--prerelease"), assets: [], html_url: `https://github.com/${state.repository}/releases/tag/${args[2]}` };
    state.releases.push(result); output(result);
  } else if (args[1] === "view") {
    const found = release(); if (!found) fail("Release not found");
    output({ assets: found.assets, isDraft: found.draft, isPrerelease: found.prerelease, url: found.html_url, body: found.body, tagName: found.tag_name });
  } else if (args[1] === "upload") {
    const found = release(); if (!found) fail("Release not found");
    if (!found.draft) fail("Cannot modify published release");
    if (args.includes("--clobber")) fail("Clobber forbidden");
    if (state.failAfterAsset && found.assets.length === 1) { state.failAfterAsset = false; fail("Injected asset interruption"); }
    const path = args[3]; const name = basename(path);
    if (found.assets.some((a) => a.name === name)) fail("Asset already exists");
    const raw = readFileSync(path);
    const id = 1000 + state.releases.flatMap((r) => r.assets).length;
    found.assets.push({ id, name, digest: `sha256:${digest(raw)}`, size: raw.length, bytes: raw.toString("base64") });
    output({});
  } else if (args[1] === "edit") {
    const found = release(); if (!found) fail("Release not found");
    found.draft = false; state.latest = args.includes("--latest=true"); state.edits = (state.edits ?? 0) + 1; output({});
  } else fail("Unexpected release command");
} else fail("Unexpected gh command");
