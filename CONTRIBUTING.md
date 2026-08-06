[English](CONTRIBUTING.md) | [Français](CONTRIBUTING.fr.md)

# Contributing

Thank you for helping improve this Docker wrapper and its playback patches.

## Before opening a change

1. Start from the latest `main` branch.
2. Create a focused branch such as `fix/...`, `feat/...` or `docs/...`.
3. Keep unrelated changes in separate pull requests.
4. Never commit credentials, signed stream URLs, private hostnames, personal IP addresses or a real `.env` file.

## Bilingual project convention

Public documentation must be provided in English and French:

- English uses the standard filename, for example `README.md` or `SECURITY.md`.
- French uses the `.fr.md` suffix, for example `README.fr.md`.
- Add a language selector at the top of each paired document.
- Comments that explain non-obvious code or configuration must contain an English line followed by its French equivalent.
- Runtime log messages may remain in English so that errors are searchable and consistent.

## Patch design

The files under `patches/` intentionally modify a precise upstream implementation during the image build.

- Use exact and auditable source anchors.
- Verify that each expected anchor occurs exactly once.
- Fail the build when the upstream source no longer matches.
- Avoid broad regular expressions or silent best-effort replacements.
- Do not log complete signed URLs or secrets.
- Document new environment variables in both configuration guides and `.env.example`.

## Validation

A pull request should, at minimum:

- build the Docker image successfully;
- pass `node --check` on the patched application;
- preserve the fail-closed patch checks;
- pass the catalog and HLS smoke tests in GitHub Actions;
- avoid publishing an image from the pull-request workflow.

When a change targets long-running playback or recovery behavior, include the relevant real-player test and sanitized log observations in the pull-request description.

## Pull requests

Use a clear title and explain what changed, why it changed, the expected user impact and the validation performed. A bilingual English/French description is encouraged for substantial user-facing changes.

By contributing, you agree that your contribution is distributed under this repository's MIT license and that any retained upstream source fragments remain subject to the upstream copyright and MIT license described in `THIRD_PARTY_NOTICES.md`.
