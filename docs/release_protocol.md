# 📦 Exact-event release protocol

This provider owns promotion and publication mechanics. Consumers own native lint,
types, unit/contract/integration checks and product builds. Domain semantics stay in
[projectRules](https://github.com/pokerlost/projectRules); generic delivery principles
stay in [baseRules](https://github.com/serrja/baseRules/blob/8434509933feaa71ba312f8d02caad7362766d5a/docs/releases.md).

## 🌿 Promotion and immutable adoption

Working branches are single lowerCamelCase identifiers from current `test`. PR routes
are working → test → dev → main; permanent branch promotions preserve ancestry.
Configure force-push/deletion protection, actual required job names and reviews in
each consumer. This provider cannot configure or bypass a consumer's protections.
The reusable promotion job validates event fields without checking out PR source.

The example pins the reviewed v0.3.0 provider source. Before an update, review the
complete provider diff, tests and release evidence; keep the workflow ref and provider-ref
identical. The native job is demonstrative and needs the consumer's real checkout/setup/checks.

```yaml
on:
  pull_request:
    branches: [test, dev, main]
  push:
    branches: [test, dev, main]
permissions:
  contents: read
jobs:
  promotion:
    if: github.event_name == 'pull_request'
    uses: pokerlost/.github/.github/workflows/promotion.yml@637ff1b505b0b9fb54847d46927a9596b1ebc967
  native:
    runs-on: ubuntu-24.04
    steps:
      # Consumer supplies its existing pinned checkout/setup and native commands.
      - run: make ci-local
  release:
    if: github.event_name == 'push' && (github.ref_name == 'dev' || github.ref_name == 'main')
    needs: native
    permissions:
      contents: write
      actions: read
    uses: pokerlost/.github/.github/workflows/release.yml@637ff1b505b0b9fb54847d46927a9596b1ebc967
    with:
      provider-ref: 637ff1b505b0b9fb54847d46927a9596b1ebc967
      native-adapter: npm
      bundle-name: example-policy
      source-workflow: .github/workflows/ci.yml
      gate-name: native
```

Complete the native job before use: it must checkout the event SHA, prepare its locked
toolchain and run every applicable check/build once. `gate-name` is the exact Actions
job name reported by that original run, including any explicit `name` or reusable-job
prefix. Do not pass shell text or `secrets: inherit`. Public provider code can be read
by private consumers using their existing token; the token writes only the caller's
repository. A successful actual private caller remains a separate acceptance condition.

## 🏷️ Native source and adapters

| Product | Version source | Build adapter | Status |
| --- | --- | --- | --- |
| This community bundle | `VERSION` | `version-file`: isolated source tar with injected VERSION | Implemented; offline regression |
| projectRules policy bundle | `package.json` plus npm lock | `npm`: isolated version injection and `npm pack --ignore-scripts --offline` | Implemented; offline regression |
| baseRules documentation | Its `package.json` and lock | Independently owned native npm pipeline | Existing upstream; no automatic caller migration |
| Python wheels/sdist | Producer's declared `pyproject.toml` backend | PEP 440 `X.Y.Z.devN` mapping plus metadata smoke | Producer adapter required; unsupported here |
| C++/Flutter/Vue/Helm products | Producer's native source | Tested external injection/build adapter | Producer contract required; unsupported here |

Unsupported adapters fail before tag allocation. Never rename a wheel or image to
pretend its embedded version changed. Native validation/build commands stay in the
consumer; this provider executes no npm lifecycle or consumer-supplied shell commands
with a write token. It creates GitHub Releases, not registry publications or deployments.

Versions are independent per repository. Stable tags are `vX.Y.Z`; prerelease tags are
`vX.Y.Z-dev.N`. Resolution uses recorded allocations, existing stable tags and the
reviewed native target. If the target is no higher than stable, the next patch is
selected, even for docs-only changes. Set a higher target in the source PR for explicit
feature/breaking intent. Dev numbers increase numerically within the target base.
Version injection changes only an isolated export, never a permanent branch commit.

## 🔄 Allocation, publication and recovery

One repository-wide `release-allocation` queue serializes allocation and publication
across dev/main. Checks run outside it. `queue: max` retains up to 100 pending jobs;
GitHub cancels overflow and does not guarantee source-event ordering. Do not add
workflow-wide cancellation to a release caller. See
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Before writes the publisher verifies the original push run ID, workflow path, branch,
event SHA, exact checkout and successful native gate. An old event stays attached to
its old SHA. An annotated tag records repository/run/branch/SHA/time/version and adapter
identity before publication. A rerun reuses that allocation. A conflicting target,
channel, identity or asset digest fails without moving tags or overwriting assets.

The publisher builds a deterministic bundle from `git archive` of the event SHA,
checks native metadata, creates a draft release, uploads missing assets and only then
publishes. Assets are the bundle, `release-manifest.json` and `checksums.sha256`.
Dev releases are prereleases with `latest=false`. Recovering an older stable event does
not replace a newer source event as latest. Tag and release are created in the same
DAG; it does not depend on `GITHUB_TOKEN` recursively starting a second workflow.

Use the actual bootstrap time and caller workflow path for a read-only audit:

```bash
GITHUB_REPOSITORY=owner/repository RELEASE_WORKFLOW=.github/workflows/ci.yml \
  RELEASE_ADAPTER=version-file RELEASE_BUNDLE_NAME=example-docs RELEASE_GATE=native \
  node scripts/reconcile.mjs 2026-11-10T00:00:00Z
```

Use the real timestamp and the caller's expected adapter/bundle/gate instead of the
examples. Reconciliation authenticates downloaded manifest/checksum bytes against
GitHub asset digests and checks the exact allocation, source SHA, native version and
bundle digest. This read-only audit trusts publisher-verified native metadata plus
GitHub's bundle digest; it does not download the complete bundle. Download and inspect
the bundle separately when independent native metadata acceptance is required.
Exit 1 means at least one original
push lacks a matching published identity/tag/assets; the output names its original run
and exact `gh run rerun` command. Review failures and rerun that original event. Missing
or failed native checks stay blocked. Actions history has finite retention: reconciliation
covers retained source runs since bootstrap, not deleted history. Preserve required
run records outside that retention window if long-term reconciliation is needed.

## 🧪 Verification limits

`make protocol-test` runs real local Git/npm/tar against a synthetic GitHub boundary:
failed gates, partial allocation, retry, tag/asset conflicts, dev/stable metadata,
lifecycle exclusion, quick dev events and old-event latest behavior. These tests do
not establish hosted private access, actual queue overflow or branch protection.
An H02 handoff must include exact provider SHA, tested caller runs and remaining gaps.

The unmodified pinned actionlint 1.7.12 rejects GitHub's newer `queue` key. The local
composite explicitly checks that extension (only `queue: max`, one repository-wide
group and no cancellation) and excludes only actionlint's exact unknown-queue diagnostic;
all other actionlint errors fail. The dependency-free extension checker conservatively
rejects flow/inline concurrency, aliases, anchors, YAML tags and alternate key syntax.
This compatibility path does not claim the unmodified
parser supports the key. Recheck tool support on updates; live GitHub parsing and hosted
queue behavior remain required acceptance evidence.
