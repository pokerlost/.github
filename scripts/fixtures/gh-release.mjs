// Synthetic GitHub API/CLI boundary for offline publisher failure and recovery tests.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const path = process.env.RELEASE_FIXTURE_STATE;
const state = JSON.parse(readFileSync(path, "utf8"));
const args = process.argv.slice(2);
const save = () => writeFileSync(path, JSON.stringify(state));
const output = (value) => { save(); console.log(JSON.stringify(value)); };
const fail = (message) => { save(); console.error(message); process.exit(1); };
const data = args.includes("--input") ? JSON.parse(readFileSync(0, "utf8")) : undefined;
if (args[0] === "api") {
  const endpoint = args.find((arg) => arg.startsWith("repos/pokerlost/.github/"))?.replace("repos/pokerlost/.github/", "");
  if (endpoint === `actions/runs/${state.event.runId}`) output({ id: Number(state.event.runId), event: "push", path: ".github/workflows/ci.yml", head_branch: state.event.branch, head_sha: state.event.sha, created_at: "2026-11-10T00:00:00Z" });
  else if (endpoint?.startsWith("actions/runs/") && endpoint.includes("/jobs")) output([{ jobs: [{ name: "validate", conclusion: state.gate }] }]);
  else if (endpoint === "git/matching-refs/tags/v") output([state.refs]);
  else if (endpoint === "releases?per_page=100") output([state.release ? [state.release] : []]);
  else if (endpoint === "git/tags" && data) {
    state.tag = { sha: "b".repeat(40), message: data.message, object: { sha: data.object, type: "commit" } }; output(state.tag);
  } else if (endpoint === "git/refs" && data) {
    if (state.refs.some((ref) => ref.ref === data.ref)) fail("Ref already exists");
    state.refs.push({ ref: data.ref, object: { sha: data.sha, type: "tag" } }); output({});
  } else if (endpoint?.startsWith("git/tags/")) output(state.tag);
  else fail(`Unexpected API ${endpoint}`);
} else if (args[0] === "release") {
  if (args[1] === "create") {
    if (state.failAfterTag) { state.failAfterTag = false; fail("Injected failure after allocation"); }
    const notes = readFileSync(args[args.indexOf("--notes-file") + 1], "utf8");
    state.release = { tag_name: args[2], body: notes, prerelease: args.includes("--prerelease"), draft: true, assets: [] }; output({});
  } else if (args[1] === "view") {
    output({ assets: state.release.assets, isDraft: state.release.draft, isPrerelease: state.release.prerelease, url: "https://github.com/fixture/release" });
  } else if (args[1] === "upload") {
    if (state.failAfterAsset && state.release.assets.length === 1) { state.failAfterAsset = false; fail("Injected asset interruption"); }
    const asset = args[3];
    state.release.assets.push({ name: asset.split("/").at(-1), digest: `sha256:${createHash("sha256").update(readFileSync(asset)).digest("hex")}` }); output({});
  } else if (args[1] === "edit") { state.release.draft = false; state.latest = args.includes("--latest=true"); output({}); }
  else fail("Unexpected release operation");
} else fail("Unexpected command");
