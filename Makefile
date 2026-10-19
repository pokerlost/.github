ifneq ($(CONTAINERIZED),1)
QUALITY_IMAGE := community:quality
QUALITY_EXTRA_TARGETS :=
COVERAGE_COMMAND = sh -ec 'printf "%s\n" "Coverage: notApplicable (documentation repository; no product runtime)." | tee coverage/summary.md'
BUILD_COMMAND = printf "%s\n" "notApplicable: Markdown/community files are the artifact"
IMAGE_COMMAND = printf "%s\n" "notApplicable: no runtime image"
VERIFY_COMMAND = printf "%s\n" "notApplicable: documentation acceptance is make check"
include docker/quality.mk
else
.PHONY: help lint typecheck test check
help:
	@printf '%s\n' 'lint typecheck test check'
lint:
	git -c safe.directory=/app show --format= --check HEAD
	python tools/check_documentation.py --documents README.md profile/README.md CONTRIBUTING.md SECURITY.md SUPPORT.md
typecheck:
	@printf '%s\n' 'notApplicable: no product type system'
test: lint
check: test
endif
