# Contributing

Open the exact component Git root and read its AGENTS and owner documentation. Use the local
Make interface; Git, Make and Docker are the primary web verification tools. A project-owned
CONTRIBUTING file overrides this supported organization default.

Use `type/shortCamelCase` for new branches and `type(scope): intent` for PR titles. Describe the
concrete behavior, compatibility, actual commands, reports, artifacts and recovery. Run each
mandatory suite once through `make check`; `make coverage` reports its fresh result without
rerunning tests. Coverage below 100% is advisory; test, build, type, configuration, access and
missing/corrupt/stale report errors remain failures. State uninstrumented metrics explicitly.

The current client delivery is web; retained Android/iOS/macOS/Linux desktop source does not
establish native acceptance. Preserve user state and historical migrations. Do not include keys,
credentials, personal data or live application records in issues, PRs or artifacts. Publication,
merge, release and deployment require the task's explicit scope and permission.
