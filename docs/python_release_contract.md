# 🐍 Python release provider contract

`h02-python/v1` extends the [release protocol](release_protocol.md) with native
wheel/sdist publication. The provider owns allocation, independent verification,
GitHub Release publication and recovery. G01 owns its backend, native version
injection, build and installed-package checks. PyPI publication is outside this contract.

Status: **H02_PENDING_ACCEPTANCE**. Local/provider checks do not establish a real G01
hosted caller, private-plan support or a G01 ACK. The delivery handoff supplies the
reviewed immutable provider SHA and its actual PR/check/release evidence.

## 🔌 Typed interface

Use `.github/workflows/python-allocate.yml`, then a separate native builder, then
`.github/workflows/python-publish.yml`. Both reusable workflows accept these required
string inputs; unknown schemas and invalid values fail closed.

| Input | Contract |
| --- | --- |
| `provider-ref` | Reviewed lowercase 40-hex provider commit, identical to both `uses` pins |
| `schema-version` | Exactly `h02-python/v1` |
| `source-workflow` | Exact original caller path, `.github/workflows/<name>.yml` or `.yaml` |
| `preflight-gate` | Exact successful native preflight job name in the original run attempt |
| `builder-job` | Exact separate native builder job name reported by Actions |
| `package-name` | Canonical lowercase Python distribution name, with hyphens as separators |
| `version-target` | Reviewed native version floor, strict `X.Y.Z` without `v` or prerelease |
| `wheel-tags` | Sorted JSON array of 1–32 distinct exact `python-abi-platform` tags |

Schema v1 reads the root `pyproject.toml` as data at the exact source SHA before
allocation. The declared package name, backend and Requires-Python become verification
constraints; the backend is never executed. For a static source version, `version-target`
must equal its PEP 440 base version. For declared dynamic versioning, G01 supplies the
explicit source-reviewed target and owns its backend-specific injection method.

Publication additionally requires `allocation`, the exact allocation output string,
and `artifact-id`, the exact immutable GitHub artifact ID as a decimal string. The
original repository, run ID, attempt, branch and full source SHA come from GitHub's
event context and are checked against its API. Only original `push` runs on `dev`
and `main` are eligible. No branch checkout, dispatch replacement SHA or tag-triggered
second workflow substitutes for that event.

Allocation outputs are strings: `allocation`, `allocation-sha256`, `release-version`
(without `v`), `python-version`, `source-sha`, `tag`, `build-required` (`true`/`false`)
and `artifact-id` (empty until a verified build is recorded). Preserve the compact
allocation JSON and its key order; its SHA-256 covers those UTF-8 bytes without a
trailing newline. A recorded build makes `build-required=false` and returns its
original artifact ID for recovery.

| GitHub release version | Native Python version |
| --- | --- |
| `v1.2.3-dev.0` | `1.2.3.dev0` |
| `v1.2.3-dev.10` | `1.2.3.dev10` |
| `v1.2.3` | `1.2.3` |

The existing shared allocator orders dev numbers numerically and selects a version
above existing stable allocations when necessary. G01 injects the **allocated**
`python-version` through its declared backend. Static `project.version` and declared
dynamic versions are supported as metadata; the provider does not implement either
producer's injection command. Renaming an archive never changes its embedded version.

## 🧱 Caller adoption skeleton

Replace every literal `PROVIDER_SHA` below with the same reviewed 40-hex SHA from the
delivery handoff before committing a caller. The token is deliberately not a
published pin. Replace the failing native hooks with G01's reviewed implementation;
this skeleton is not evidence that such a G01 builder already exists.

```yaml
name: Python native delivery
on:
  push:
    branches: [dev, main]
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
      - name: G01 supplies the real native preflight
        run: |
          echo 'Replace this hook with the reviewed native checks.' >&2
          exit 1
  allocation:
    needs: preflight
    permissions:
      contents: write
      actions: read
    uses: pokerlost/.github/.github/workflows/python-allocate.yml@PROVIDER_SHA
    with:
      provider-ref: PROVIDER_SHA
      schema-version: h02-python/v1
      source-workflow: .github/workflows/python-delivery.yml
      preflight-gate: preflight
      builder-job: builder
      package-name: example-package
      version-target: 1.2.3
      wheel-tags: '["py3-none-any"]'
  builder:
    needs: allocation
    if: needs.allocation.outputs.build-required == 'true'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      actions: read
      id-token: write
      attestations: write
    outputs:
      artifact-id: ${{ steps.upload.outputs.artifact-id }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ needs.allocation.outputs.source-sha }}
          persist-credentials: false
      - name: G01 supplies native injection, build, smoke and receipt
        env:
          ALLOCATION_JSON: ${{ needs.allocation.outputs.allocation }}
          ALLOCATION_SHA256: ${{ needs.allocation.outputs.allocation-sha256 }}
          RELEASE_VERSION: ${{ needs.allocation.outputs.release-version }}
          PYTHON_VERSION: ${{ needs.allocation.outputs.python-version }}
          SOURCE_SHA: ${{ needs.allocation.outputs.source-sha }}
        run: |
          echo 'Replace this hook with the reviewed G01 native builder.' >&2
          exit 1
      - uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4
        with:
          subject-path: dist/*
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        id: upload
        with:
          name: h02-python-${{ github.run_id }}-${{ github.run_attempt }}
          path: dist/*
          if-no-files-found: error
          compression-level: 0
  publication:
    needs: [allocation, builder]
    if: >-
      always() && needs.allocation.result == 'success' &&
      (needs.builder.result == 'success' ||
      (needs.builder.result == 'skipped' && needs.allocation.outputs.build-required == 'false'))
    permissions:
      contents: write
      actions: read
      attestations: read
    uses: pokerlost/.github/.github/workflows/python-publish.yml@PROVIDER_SHA
    with:
      provider-ref: PROVIDER_SHA
      schema-version: h02-python/v1
      source-workflow: .github/workflows/python-delivery.yml
      preflight-gate: preflight
      builder-job: builder
      package-name: example-package
      version-target: 1.2.3
      wheel-tags: '["py3-none-any"]'
      allocation: ${{ needs.allocation.outputs.allocation }}
      artifact-id: ${{ needs.allocation.outputs.artifact-id || needs.builder.outputs.artifact-id }}
```

Use the actual Actions job names, including reusable-job prefixes when present.
The inline native builder receives no `contents:write`, registry/release token or
publication secret. `attestations:write` and `id-token:write` authorize its provenance,
not GitHub Release publication. These permissions are job capabilities; G01 must keep
the native job reviewed and use the OIDC/attestation token only in its signer step.
Do not add `secrets: inherit`. Allocation and publication
share `release-allocation` with existing VERSION/npm callers, with `queue: max` and no
event cancellation. Native checks/builds run outside that queue.

## 📦 Allocation, build and release records

The annotated `v<release-version>` tag targets the original full event SHA before
the build. Its allocation has `schemaVersion: 2`, the original repository/run/branch/
SHA/event timestamp/workflow/preflight identity and adapter/package/version fields.
Python fields are `providerRef`, `contractSchema`, `builderJob`, `versionTarget`,
`wheelTags`, `allocationAttempt` and `pythonVersion`. Conflicting identity or target
never moves a tag or obtains another version for that run.

The builder uploads exactly one `.tar.gz` sdist, one wheel for each declared tag,
and `python-build-receipt.json` as flat artifact members. Real package bytes keep
their native filenames. The receipt contains exactly these fields:

```json
{
  "schemaVersion": 1,
  "allocationSha256": "SHA256_OF_EXACT_ALLOCATION_OUTPUT",
  "runId": "ORIGINAL_RUN_ID",
  "runAttempt": "BUILD_ATTEMPT",
  "sourceSha": "FULL_ORIGINAL_SOURCE_SHA",
  "builderJob": "builder",
  "builderJobId": "ACTUAL_GITHUB_JOB_ID",
  "buildTool": {
    "backend": "DECLARED_NATIVE_BACKEND",
    "backendVersion": "ACTUAL_BACKEND_VERSION",
    "frontend": "ACTUAL_BUILD_FRONTEND",
    "frontendVersion": "ACTUAL_FRONTEND_VERSION",
    "versionInjection": "REVIEWED_NATIVE_INJECTION_METHOD"
  },
  "files": []
}
```

`files` is the ordered native metadata result from
`scripts/python_artifacts.py verify --allocation <file> --directory <dist>
--source-pyproject <original-pyproject> --version-target <X.Y.Z>`: each entry has
`name`, `sha256`, `packageName`, `version`, optional `requiresPython`, and `tags` for
a wheel or `buildBackend` for the sdist. It must list every distribution in filename
order. The receipt backend must match the verified native backend. The receipt
records actual tools and injection, not placeholder strings. Attest every wheel,
sdist and the completed receipt with the SLSA provenance predicate.

After independent verification, the publisher records the exact artifact ID/digest,
original build attempt/job, distribution metadata, receipt checksum and verified
signed proof bundles in an annotated `h02-python-build/v<release-version>` tag before
creating a draft. This append-only build record preserves recovery bytes and proof
selection. No caller can replace it with a newly built artifact.

Published assets are the original wheels/sdist, `python-build-receipt.json`,
`provenance.json`, `release-manifest.json` and `checksums.sha256`. Manifest schema 2
links the allocation, artifact transport, original build attempt/job, distributions,
receipt and provenance checksums. Provenance schema 1 stores exact signed bundles.
Checksums cover all assets except the checksum file itself. Dev is a prerelease with
`latest=false`; an older recovered main event does not become latest over a newer one.

## 🔎 Independent verification and trust limits

The read-only job verifies the exact artifact ID, API archive digest and all native
metadata. Only its successful dependent publisher receives `contents:write`; that
publisher repeats verification before writes and executes only pinned provider code.
Neither job checks out consumer source, installs a consumer wheel, imports its code
or executes a packaging backend. G01 owns installed-wheel smoke in its unprivileged job.

Wheel verification checks Name/Version, canonical filename identity, WHEEL tags,
RECORD inventory/sizes/SHA-256 and archive structure. Sdist verification checks one
matching root, PKG-INFO, declared pyproject backend, static/dynamic version declaration
and Requires-Python consistency against the original source contract. Expected wheel
ABI/platform variants are explicit;
multiple wheels are supported. This schema rejects compressed multi-tag filenames,
wheel build-number suffixes, archive links/special entries and undeclared extra files.
Transport is limited to 256 MiB compressed; expanded data is bounded to 1 GiB, each
member to 256 MiB, metadata/receipt to 4 MiB and archive members to 20,000. Sdists also
have a 1000:1 expansion bound. Reject unsupported sets instead of renaming them.

`gh attestation verify` cryptographically verifies each distribution and receipt,
requiring the exact repository, source SHA/ref, caller workflow SHA, hosted runner,
predicate and authenticated certificate run/attempt. The artifact name/run/SHA and
creation time must match the successful named builder job; the attested receipt binds
its actual job ID and tools. This version supports an inline builder in the original
caller workflow. A separately reusable native builder requires a reviewed signer
contract extension; arbitrary receipt JSON alone is not attestation.

[GitHub artifact digests](https://docs.github.com/en/actions/tutorials/store-and-share-data)
do not make download warnings fatal; this provider compares them explicitly.
[Attestation eligibility](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
on Free/Pro/Team covers public repositories. Private/internal repositories require
Enterprise Cloud; a different trust model needs explicit G01 agreement before acceptance.
[GitHub CLI verification](https://cli.github.com/manual/gh_attestation_verify) and
[Python wheel](https://packaging.python.org/en/latest/specifications/binary-distribution-format/),
[sdist](https://packaging.python.org/en/latest/specifications/source-distribution-format/)
and [version](https://packaging.python.org/en/latest/specifications/version-specifiers/)
specifications define the underlying formats.

## 🔄 Recovery and hosted acceptance

Use `gh run rerun <original-run-id> --repo <consumer>` to rerun the complete original
workflow. Its new attempt repeats preflight, reuses the allocation and skips native
rebuilding when an immutable verified build exists. Rerunning only failed jobs is not
the recovery contract: current-attempt preflight evidence must be available.

| State | Provider behavior |
| --- | --- |
| Failed/missing preflight | No allocation or publication |
| Allocation exists; verified build absent | Rebuild the original source with the same allocated version |
| Verified build exists; draft incomplete | Reuse the original artifact/receipt/proofs; upload only missing matching assets |
| Already published | Audit the stored original release bytes and proofs; do not republish or change latest |
| Contradictory tag/body/channel/asset/provenance | BLOCKED; no overwrite, clobber or tag movement |

Published-release audit can use its saved proof bundles after Actions artifact expiry;
the original successful job records must still be retained. An unfinished draft still
requires its original verified transport artifact. Read-only reconciliation must report
missing wheel/sdist or unverifiable proof as incomplete, never READY.

Run reconciliation from the reviewed provider checkout with a read-only token and
the same original contract inputs. Replace the examples and actual bootstrap time:

```bash
GITHUB_REPOSITORY=owner/repository RELEASE_ADAPTER=python \
  RELEASE_PROVIDER_REF=PROVIDER_SHA RELEASE_SCHEMA=h02-python/v1 \
  RELEASE_WORKFLOW=.github/workflows/python-delivery.yml \
  RELEASE_GATE=preflight RELEASE_BUILDER=builder \
  RELEASE_BUNDLE_NAME=example-package RELEASE_VERSION_TARGET=1.2.3 \
  RELEASE_WHEEL_TAGS='["py3-none-any"]' \
  node scripts/reconcile.mjs 2026-11-14T00:00:00Z
```

Exit 0 means all retained matching events since that time independently verified;
exit 1 means at least one needs build/recovery or is blocked. Each result includes
the full source SHA, original run ID and exact full-run rerun command. The audit
does not create tags, edit releases or upload missing assets.

Joint acceptance requires G01-owned real dev and main runs, native wheel/sdist metadata
and installed smoke, verified attestations, exact event/allocation/tag/assets/digests,
an interrupted-draft rerun with unchanged identity, and a documented G01 ACK/run link.
Until that evidence exists, retain **H02_PENDING_ACCEPTANCE**; do not claim
`PYTHON_RELEASES_ACCEPTED` or that G01 received/accepted the handoff.
