# Pokerlost organization profile

GitHub renders [profile/README.md](profile/README.md) on the Pokerlost organization page. Keep this public page limited to facts approved for public display. The detailed component overview belongs to a separate private repository.

From this exact Git root, `make check` runs whitespace and Markdown/link checks in Docker.
`make coverage` reads that fresh result without rerunning checks. Coverage, distributions and
runtime acceptance are `notApplicable` for this documentation repository. Git, Make and Docker
suffice; no application SDK is needed.

Supported community defaults are [contributing](CONTRIBUTING.md), [security](SECURITY.md),
[support](SUPPORT.md), [PR template](.github/PULL_REQUEST_TEMPLATE.md) and issue forms. Component-local
files override defaults. GitHub does not inherit workflows, CODEOWNERS, licenses, branch
protection, secrets or repository settings from this repository; those are configured and
verified per repository. The public profile makes no claim about private service readiness.
