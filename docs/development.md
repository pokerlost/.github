# Development

This repository owns the `pokerlost-community` documentation bundle. Use Git, Make,
Docker and Buildx from its exact root; no application SDK or runtime is required.

```bash
make help
make version
make ci-local
make coverage
make release-check
```

`check` runs the existing whitespace, Markdown and local-link acceptance once;
`test` selects the same applicable suite. `build` creates a deterministic source
archive in ignored `dist/`; `verify` compares its inventory and bytes with current
source. There is no product runtime or runtime image. Coverage is explicitly not
applicable to prose; measured coverage in other projects remains advisory below
100%. Invalid documents, failed commands and stale or damaged evidence fail.

`ci-local` preserves source commit, dirty state, content identity, commands, tool
versions, exit codes and artifact hashes in ignored `coverage/`. Hosted CI calls
the same entrypoint. These reports stay local; no new artifact-upload workflow is
configured. The first locked tool image build may need network access. After
preparing the exact image and inputs, `make ci-local OFFLINE=1` checks that cache
before running without network; missing or changed inputs are blocked.

The shared Make/source/receipt helpers belong to pythonTemplate. Refresh their
reviewed snapshots through its engineering updater and record the exact source;
do not create a parallel runner here. See [versioning](versioning.md) and
[release](release-guide.md) before changing the bundle contract.
