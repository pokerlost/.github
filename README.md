# 🧭 Pokerlost community and delivery

This public repository owns organization community defaults, the
[profile](profile/README.md), reusable promotion and exact-event GitHub Release workflows.
Pokerlost domain policy belongs to [projectRules](https://github.com/pokerlost/projectRules).

## 🧪 Checks

From this Git root, with Git, Make, Docker/Buildx and Node 24 (including npm):

```bash
make help
make ci-local
```

The gate checks documentation and local links, tests release failure/recovery against a
synthetic GitHub boundary, builds the versioned source bundle and verifies its bytes.
Reports stay in ignored `coverage/`. Read [development](docs/development.md) for
individual commands and limits. There is no runtime application or production deployment.

## 📦 Consumer entrypoints

- [Release protocol and adoption](docs/release_protocol.md): typed inputs, immutable pins,
  supported version adapters, source-event identity, queue limits and recovery.
- [Contribution default](CONTRIBUTING.md), [security](SECURITY.md), [support](SUPPORT.md),
  [PR template](.github/PULL_REQUEST_TEMPLATE.md) and [issue forms](.github/ISSUE_TEMPLATE/bug.yml).
- [Versioning](docs/versioning.md) and [release guide](docs/release_guide.md).

GitHub community defaults apply where a component has no local override. Workflows,
CODEOWNERS, licenses, branch protections and secrets must be configured in each consumer;
placing workflows here does not activate them elsewhere. Private callers can use this
public provider without exposing their source. Their access and native gates still need
an actual caller run before H02 is accepted.

## 📄 License

Original source/documentation uses [MIT](LICENSE). Preserve
[third-party notices](THIRD_PARTY_NOTICES.md); dependencies retain their own terms.
