# 🤝 Contributing

This is the organization default; a component-local CONTRIBUTING file supplies its
own commands and overrides. Read its AGENTS, pinned
[generic rules](https://github.com/serrja/baseRules/blob/8434509933feaa71ba312f8d02caad7362766d5a/docs/engineering.md)
and Pokerlost policy before changing source. Keep public material safe to publish.

## 🧪 Work in this repository

Use Git, Make, Docker/Buildx, Node 24 and npm. From a clean checkout run:

```bash
make ci-local
```

For a narrow loop use `make check` (documents and release regressions); full local CI
also builds and verifies the documentation bundle. [Development](docs/development.md)
explains source receipts, offline preparation and individual commands. Tests create
isolated synthetic repositories and never call live GitHub. State failed, blocked and
unexecuted checks accurately; whitespace or link checks do not prove runtime behavior.

## 🌿 Review and delivery

Create one lowerCamelCase working branch from current `test`, for example
`refactorG02Delivery`. Use a Conventional Commits PR title such as
`ci(release): preserve exact event identity`. Submit working → test, then separate
promotion PRs test → dev and dev → main. Promotions preserve ancestry; never delete
or force-push permanent branches, squash them together, or bypass reviews/checks.

Explain the observed problem, resulting behavior, compatibility and executed checks.
Include migration/recovery only where applicable. Before merge, verify exact head SHA,
full diff, current protection, required checks, approvals and repository identity.
A push to dev/main must pass its native gate and receive an exact-SHA tag and GitHub
Release; see the [release protocol](docs/release_protocol.md). Registry publication
and deployment require their own scope and permission.

## 🔐 Compatibility and reports

Preserve API/wire names, migrations, licenses and consumer pins unless a reviewed
migration defines the transition. Source code, runtime checks and contracts stay with
their owners. Do not attach credentials, private endpoints, production records or personal
data. Report vulnerabilities through [security guidance](SECURITY.md).
