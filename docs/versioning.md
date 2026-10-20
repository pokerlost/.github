# Versioning

[VERSION](../VERSION) is the only version source for the `pokerlost-community` bundle.
It is independent of application versions and other documentation repositories.
Markdown, assets, community files and configuration schemas belong to the bundle
and its Git snapshot; individual pages and images have no separate runtime version.

Use patch increments for compatible corrections, minor increments for compatible
new guidance, and major increments for incompatible public contract changes after
1.0. During 0.x, an incompatible contract change requires a minor increment and a
migration note. Prerelease candidates use PEP 440 `rcN` or `.devN`; the native
shared checker validates the version. Keep any explicit schema version tied to
its actual serialization contract, not routine text edits.

`make version` reads VERSION. `make release-check` checks the built archive's
source identity, inventory and version without publishing. A release tag is one
new annotated `v<version>` at a clean, reviewed and checked main commit. Never
move a published tag. See [release workflow](release-guide.md).
