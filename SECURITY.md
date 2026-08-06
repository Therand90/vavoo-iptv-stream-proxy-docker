[English](SECURITY.md) | [Français](SECURITY.fr.md)

# Security policy

## Supported versions

Only the current `main` branch and the most recently published container image are supported. Older `upstream-*` image tags are immutable references for troubleshooting and rollback, but they do not receive fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature from the repository's **Security** tab when it is available. Do not publish credentials, signed stream URLs, private addresses, exploit details or other sensitive data in a public issue.

If private vulnerability reporting is unavailable, contact the maintainer through the GitHub profile first and wait for a private communication channel before sharing technical details.

## Deployment boundary

This service is designed for local or trusted private-network use.

- Keep `VAVOO_BIND_ADDRESS=127.0.0.1` unless access from a private network is explicitly required.
- Do not expose the container port directly to the public Internet.
- When remote access is needed, prefer WireGuard, another authenticated VPN, or an authenticated reverse proxy with strict access controls.
- Do not place tokens or passwords in `compose.yaml`, Docker image layers, logs or committed `.env` files.
- Keep the image and Docker host updated.

The local HLS proxy uses signed internal URLs to prevent callers from turning `/hls-proxy` into an arbitrary HTTP proxy. This protection is defense in depth and does not make public exposure recommended or supported.

## Supply-chain controls

The repository uses several controls to reduce build and publication risk:

- every third-party GitHub Action is pinned to a verified full commit SHA;
- the official Node.js base image is pinned to a digest and monitored by Dependabot;
- the upstream application is fetched from an exact commit and installed with its lockfile using `npm ci`;
- patch scripts validate exact source anchors and fail the build when the expected upstream implementation changes;
- pull requests have read-only workflow permissions and cannot publish images;
- package-write permission is granted only to the dedicated publication job;
- published images include BuildKit provenance and an attached SBOM;
- the always-on repository policy workflow validates documentation pairs, secret hygiene, immutable build inputs and Docker Compose.

Users who require reproducible deployment should pin the published image by digest.

## Upstream trust

The image downloads a precise upstream commit during validated CI builds and applies fail-closed patch scripts. A changed upstream source that no longer matches the expected anchors causes the build to fail instead of silently producing an unpatched image.

## Legal and content security

This repository contains software only. It does not grant rights to television channels, streams, trademarks or audiovisual works. Users are responsible for complying with applicable laws, service terms and content rights.
