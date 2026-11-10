# 📦 Release guide

Every new dev/main push, including documentation-only changes, is checked and released
at its original event SHA. The [protocol](release_protocol.md) owns the common algorithm.

## 🌿 Integrate

Review the complete working → test PR, checks, protected branch settings and approvals.
Use separate ancestry-preserving test → dev and dev → main PRs. Do not promote unrelated,
unreviewed commits. Read back the merged state and resulting merge commit after each step.

## 🏷️ Verify

The native `validate` gate precedes release. The publisher checks the original Actions
run, SHA and successful native job, then allocates a version in one repository-wide
queue. Dev tags use `vX.Y.Z-dev.N`, prerelease and `latest=false`; main tags use
`vX.Y.Z`. Download the bundle, release manifest and checksums, compare embedded VERSION,
source event SHA and peeled tag target. Never move published tags or overwrite assets.

## 🔄 Recover

For a partial or canceled event use the read-only reconciliation command and rerun the
original source run shown in its output. Preserve the recorded allocation. A failed gate,
identity conflict or unavailable protection blocks that delivery step. There is no
production deployment or registry publication in this DAG. Keep valuable release notes
and old immutable source links when updating guidance.
