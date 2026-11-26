# Validated dependency snapshot

The files in this directory were exported from the locally tested recovery image for upstream `Haehnchen/vavoo-iptv-stream-proxy@4dc8ece08a075944fad95681784475431450279a` on 2026-11-25.

SHA-256:

- `package.json`: `2d72e9b6ae7ae671d3498cbf4bdc23dbc1cc4f04e11db5b8765ffad4002df93b`
- `package-lock.json`: `64757d56b2c9f124aab29169f0dfd95028c8c2fd85c257892e1621cb60fcd400`

The Dockerfile uses this exact lock only for the matching upstream revision and verifies that the manifest is identical before applying it. Other revisions keep their upstream lockfile. Every build uses `npm ci` and must pass the production dependency audit; the build does not run `npm audit fix`. This intentionally fails closed if the audit fails or cannot complete.

The local audit reported zero known vulnerabilities at validation time; this does not guarantee future audit results or validate TLS settings.
