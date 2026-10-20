# Release workflow

Review and verify this documentation bundle before integrating or tagging it.

1. Review public compatibility, choose the VERSION increment and update the
   changelog. Preserve access boundaries and unrelated source or user changes.
2. Run `make ci-local` and `make release-check`. Review the full diff, source
   identity, archive checksum and actual mandatory results. Missing or failed
   checks block delivery; a billing-blocked hosted check is not a local PASS.
3. Review the PR and merge only when required checks pass. Inspect tag-triggered
   workflows before creating a new annotated `v<version>` at that exact clean
   main commit. Push only that named tag and verify its remote tag object and
   peeled commit; never force-update tags or use a blanket tag push.
4. Package publication, GitHub Releases and deployment remain separate actions.
   This documentation workflow creates no runtime deployment or registry output.

CI currently runs for main and pull requests, not tags; recheck immediately before
a tag push. Preserve previous archives and refs for review and recovery. Reports
under `coverage/` remain local and must not contain credentials or private data.
