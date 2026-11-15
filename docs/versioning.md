# 🏷️ Versioning

[VERSION](../VERSION) is the independent native source for the `pokerlost-community`
documentation bundle. Individual pages and assets have no separate runtime version.

## 📦 Mapping

Native and GitHub versions use SemVer: `X.Y.Z-dev.N` for dev and `X.Y.Z` for main;
tags prepend `v`. The publisher derives the next version from immutable allocations,
stable history and this native target. An unchanged target defaults to the next patch
after stable, including documentation-only pushes. Set a higher native target in the
reviewed change to express feature/breaking intent; explain migration consequences.

Version injection happens only in an isolated export of the exact event SHA. The
bundle's VERSION and release manifest must agree; no release commit is pushed back.
Old tags are preserved. `make version` reads source metadata and `make release-check`
validates the local native archive without publishing. See [protocol](release_protocol.md).

The Python provider maps allocated `1.2.3-dev.0` to `1.2.3.dev0`,
`1.2.3-dev.10` to `1.2.3.dev10` and stable `1.2.3` to `1.2.3`.
G01 injects that value through its declared native backend in an unprivileged job;
filenames and embedded package metadata must already agree. See the
[Python contract](python_release_contract.md).
