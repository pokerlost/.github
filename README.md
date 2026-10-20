# Pokerlost organization profile

GitHub renders [profile/README.md](profile/README.md) on the Pokerlost organization page. Keep this public page limited to facts approved for public display. The detailed component overview belongs to a separate private repository.

From this exact Git root, `make ci-local` checks Markdown/links once, builds a versioned
source bundle and verifies its bytes. `make version` reads [VERSION](VERSION);
`make coverage` reports the current documentation result without rerunning checks.
Git, Make and Docker suffice; product runtime coverage and deployment are not applicable.
See [development](docs/development.md), [versioning](docs/versioning.md) and
[release workflow](docs/release-guide.md). Reports stay in ignored `coverage/`.

Supported community defaults are [contributing](CONTRIBUTING.md), [security](SECURITY.md),
[support](SUPPORT.md), [PR template](.github/PULL_REQUEST_TEMPLATE.md) and issue forms. Component-local
files override defaults. GitHub does not inherit workflows, CODEOWNERS, licenses, branch
protection, secrets or repository settings from this repository; those are configured and
verified per repository. The public profile makes no claim about private service readiness.

## 📄 License

Original source/documentation uses [MIT](LICENSE). Preserve the
[third-party notices](THIRD_PARTY_NOTICES.md); upstream assets, distributions and
private data retain their own terms and access boundaries.
