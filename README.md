[English](README.md) | [Français](README.fr.md)

# VAVOO IPTV Stream Proxy — Docker

A validated Docker wrapper for the upstream [`Haehnchen/vavoo-iptv-stream-proxy`](https://github.com/Haehnchen/vavoo-iptv-stream-proxy) project.

The image downloads a precise upstream commit, applies auditable fail-closed playback patches, installs the locked Node.js dependencies, runs syntax and live smoke tests, and publishes the image to GitHub Container Registry only after validation.

> [!IMPORTANT]
> This is an unofficial community project and is not affiliated with, endorsed by or operated by VAVOO or the upstream author. The repository contains software only; it does not bundle television channels or audiovisual content.

## Container image

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:latest
```

Every validated upstream revision also receives an immutable reference-style tag:

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:upstream-<first-12-characters-of-SHA>
```

Use `latest` for convenience. Prefer an `upstream-*` tag or an image digest when a reproducible deployment matters.

## What this wrapper adds

The upstream proxy provides the catalog, stable local channel IDs and on-demand stream resolution. This wrapper adds Docker packaging and several Kodi-oriented playback improvements:

1. **Long-lived catalog cache** — keeps the channel catalog for six hours by default so a player restart does not wait for a full catalog reload.
2. **Renewable HLS entry point** — keeps Kodi on a stable local `/hls-channel/:id` URL and refreshes signed upstream stream URLs before their usual hourly expiry.
3. **Playlist recovery** — retries short upstream failures and can serve the last valid playlist while obtaining a fresh signed URL.
4. **Media-segment recovery** — retries HLS assets, buffers successful responses and keeps a short bounded memory cache for immediate player retries.
5. **Segment prefetching** — preloads the most recent playlist segments and shares in-flight downloads with the player to reduce brief stalls.
6. **Signed internal proxy URLs** — signs generated `/hls-proxy` URLs so the endpoint cannot be used as an arbitrary unsigned HTTP proxy.

Each patch checks that the expected upstream source appears exactly once. An incompatible upstream change stops the build instead of silently publishing a partially patched image.

## Quick start

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
```

The default Compose configuration listens only on the local loopback interface:

```text
http://127.0.0.1:8899
```

Useful endpoints:

```text
http://127.0.0.1:8899/countries
http://127.0.0.1:8899/channels.m3u8
http://127.0.0.1:8899/channels.m3u8?country=France
```

The default mode keeps HLS playback inside the local proxy. It does **not** enable `--redirect`, because direct redirection would remove the proxy from the playback path and prevent transparent URL renewal.

## Configuration

The most important defaults are:

```dotenv
VAVOO_BIND_ADDRESS=127.0.0.1
VAVOO_PORT=8899
VAVOO_CHANNELS_CACHE_TTL_SECONDS=21600
VAVOO_STREAM_URL_TTL_SECONDS=3000
VAVOO_PLAYLIST_CACHE_TTL_SECONDS=300
VAVOO_HLS_ASSET_CACHE_TTL_SECONDS=45
VAVOO_HLS_ASSET_MAX_CACHE_BYTES=12582912
VAVOO_HLS_PREFETCH_SEGMENT_COUNT=2
```

See the complete [configuration reference](docs/CONFIGURATION.md) before changing cache, memory or network settings.

## Security

> [!WARNING]
> Do not expose port `8899` directly to the public Internet. Keep the default loopback binding or use a trusted private network such as WireGuard. An authenticated reverse proxy and strict firewall rules are required when local-only access is impossible.

The container is hardened by default with:

- a non-root runtime user;
- a read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges` enabled;
- a small temporary filesystem mounted only at `/tmp`;
- loopback-only host port publishing.

Read the full [security policy](SECURITY.md).

## Automated synchronization and validation

GitHub Actions checks the upstream `main` branch every six hours. A build is requested when a new upstream commit is detected or when this wrapper changes. A scheduled rebuild is also forced periodically so base-image security updates are not ignored merely because the upstream SHA stayed unchanged.

Before publication, the workflow:

1. resolves and records the exact upstream commit;
2. builds the patched image;
3. verifies required patch markers and default values;
4. runs `node --check` during the Docker build;
5. starts the image temporarily;
6. validates `/countries`, the French playlist and the renewable HLS master entry point;
7. publishes `upstream-<SHA>` and `latest` only after all checks pass.

Pull requests run the same build and smoke tests without publishing an image.

## Building from source

Pass an exact upstream commit rather than a moving branch:

```bash
docker build \
  --build-arg UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy \
  --build-arg UPSTREAM_REF=<full-upstream-commit-sha> \
  -t vavoo-iptv-stream-proxy:local .
```

The build requires the upstream `package-lock.json` and uses `npm ci`; it fails rather than falling back to an unlocked dependency installation.

## Updating

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

If the GHCR package is private, authenticate with a token that has package read permission:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u Therand90 --password-stdin
```

Never commit the token or place it directly in `compose.yaml`.

## Documentation

- [Configuration](docs/CONFIGURATION.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

All public documentation is maintained in English and French. Non-obvious source and configuration comments follow the same bilingual convention.

## License and content disclaimer

The files created specifically for this repository are distributed under the [MIT License](LICENSE). The upstream project remains © 2022 Daniel Espendiller under its own MIT license; see [third-party notices](THIRD_PARTY_NOTICES.md).

These software licenses do not grant rights to television channels, streams, trademarks or audiovisual works. Users are responsible for complying with applicable laws, service terms and content rights.
