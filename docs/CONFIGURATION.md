[English](CONFIGURATION.md) | [Français](CONFIGURATION.fr.md)

# Configuration reference

Copy the example file before starting the service:

```bash
cp .env.example .env
docker compose up -d
```

## Network and catalog

| Variable | Default | Purpose |
|---|---:|---|
| `VAVOO_BIND_ADDRESS` | `127.0.0.1` | Host address used by the published Docker port. Keep the default unless a trusted private network needs direct access. |
| `VAVOO_WIREGUARD_BIND_ADDRESS` | empty | Optional second host address used by the native LibreELEC helper. It keeps the loopback binding for Kodi while also publishing the same port on one specific trusted WireGuard address. `0.0.0.0` is rejected. |
| `VAVOO_PORT` | `8899` | Host port mapped to container port `8888`. |
| `VAVOO_LANGUAGE` | `en` | Language sent to the upstream APIs. |
| `VAVOO_REGION` | `US` | Region sent to the upstream APIs. `US` generally keeps a broad catalog. |
| `VAVOO_URL_LIST` | `both` | Upstream selection: `primary`, `fallback` or `both`. |
| `VAVOO_CHANNELS_CACHE_TTL_SECONDS` | `21600` | Channel-catalog cache duration. Values below 300 seconds fall back to the default. |

`VAVOO_WIREGUARD_BIND_ADDRESS` is currently consumed by `scripts/libreelec-vavoo.sh`; the supplied Compose file continues to use `VAVOO_BIND_ADDRESS` only. On LibreELEC, a typical trusted setup is:

```dotenv
VAVOO_BIND_ADDRESS=127.0.0.1
VAVOO_WIREGUARD_BIND_ADDRESS=10.13.13.2
VAVOO_PORT=8899
```

This produces two host bindings for the same container port: loopback for Kodi and the selected WireGuard address for trusted remote checks. Do not use a public address or `0.0.0.0` as the secondary binding.

## Playback resilience

| Variable | Default | Purpose |
|---|---:|---|
| `VAVOO_STREAM_URL_TTL_SECONDS` | `3000` | Local lifetime of a signed stream URL. Fifty minutes renews it before the typical hourly expiry. Values below 300 fall back to the default. |
| `VAVOO_PLAYLIST_CACHE_TTL_SECONDS` | `300` | Lifetime of the last valid media playlist used during temporary upstream failures. |
| `VAVOO_HLS_ASSET_CACHE_TTL_SECONDS` | `45` | Short memory-cache lifetime for successfully downloaded HLS media assets. |
| `VAVOO_HLS_ASSET_MAX_CACHE_BYTES` | `12582912` | Maximum size of one cached media asset, in bytes. The default is 12 MiB. |
| `VAVOO_HLS_PREFETCH_SEGMENT_COUNT` | `2` | Number of most recent media segments prefetched from each renewed playlist. Set to `0` to disable prefetching. |
| `VAVOO_HLS_PROXY_SECRET` | generated at startup | Optional persistent secret used to sign internal `/hls-proxy` URLs. Leave empty for one container. Set the same strong secret on every replica when several instances must accept one another's signed URLs. |

## Security notes

The default Compose mapping publishes the service only on `127.0.0.1`. To use it from another trusted device, bind it to a private address or access it through WireGuard. Binding to `0.0.0.0` may expose the service on every interface and is not recommended without an authenticated firewall or reverse proxy.

Generate a persistent proxy secret with, for example:

```bash
openssl rand -hex 32
```

Never commit the generated value. Put it only in the local `.env` file or a secret-management system.

## Updating

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

The `upstream-<SHA>` tag identifies the upstream source revision, but it may be refreshed when this wrapper or its base image changes. Use the image digest when byte-for-byte reproducibility is required.
