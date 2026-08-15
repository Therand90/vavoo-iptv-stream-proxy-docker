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
| `VAVOO_PORT` | `8899` | Host port mapped to container port `8888`. |
| `VAVOO_LANGUAGE` | `en` | Language sent to the upstream APIs. This setting does not filter stream audio language. |
| `VAVOO_REGION` | `US` | Region sent to the upstream APIs. `US` generally keeps a broad catalog. |
| `VAVOO_URL_LIST` | `both` | Upstream selection: `primary`, `fallback` or `both`. |
| `VAVOO_CHANNELS_CACHE_TTL_SECONDS` | `21600` | Channel-catalog cache duration. Values below 300 seconds fall back to the default. |

## Playback resilience

| Variable | Default | Purpose |
|---|---:|---|
| `VAVOO_STREAM_URL_TTL_SECONDS` | `3000` | Local lifetime of a signed stream URL. Fifty minutes renews it before the typical hourly expiry. Values below 300 fall back to the default. |
| `VAVOO_PLAYLIST_CACHE_TTL_SECONDS` | `300` | Lifetime of the last valid media playlist used during temporary upstream failures. |
| `VAVOO_HLS_ASSET_CACHE_TTL_SECONDS` | `45` | Short memory-cache lifetime for successfully downloaded HLS media assets. |
| `VAVOO_HLS_ASSET_MAX_CACHE_BYTES` | `12582912` | Maximum size of one cached media asset, in bytes. The default is 12 MiB. |
| `VAVOO_HLS_PREFETCH_SEGMENT_COUNT` | `2` | Number of most recent media segments prefetched from each renewed playlist. Set to `0` to disable prefetching. |
| `VAVOO_VARIANT_QUARANTINE_SECONDS` | `300` | Temporary quarantine applied to a variant after an ordinary fetch error or stale playlist. |
| `VAVOO_LOOP_DETECTION_ENABLED` | `true` | Enables the lightweight MPEG-TS/H.264 video-loop detector. |
| `VAVOO_LOOP_SIMILARITY_THRESHOLD` | `0.70` | Minimum similarity used by video-repeat detection. |
| `VAVOO_LOOP_MIN_COMMON_NALS` | `100` | Minimum number of common NAL units required before a repeat is meaningful. |
| `VAVOO_LOOP_CONFIRMATIONS` | `2` | Consecutive detections required before quarantining a variant. |
| `VAVOO_LOOP_HISTORY_SEGMENTS` | `8` | Number of historical segments kept when looking for repetition. |
| `VAVOO_LOOP_QUARANTINE_SECONDS` | `1800` | Quarantine duration after a video loop is confirmed. |
| `VAVOO_QUALITY_RANKING_ENABLED` | `true` | Ranks variants by resolution, frame rate, bitrate and loop signals when no healthy active variant exists. |
| `VAVOO_QUALITY_CACHE_SECONDS` | `1800` | Lifetime of cached quality and audio-language measurements for a variant. |
| `VAVOO_HLS_PROXY_SECRET` | generated at startup | Optional persistent secret used to sign internal `/hls-proxy` URLs. Leave empty for a single container. Set the same strong secret on every replica when several instances must accept one another's signed URLs. |

## Logical-variant audio language

The proxy reuses the same playlists and media segments that are already downloaded for quality ranking. It first inspects HLS `#EXT-X-MEDIA` declarations and then ISO-639 descriptors in MPEG-TS PMT tables. No additional media download is required when a quality probe is already running.

| Variable | Default | Purpose |
|---|---:|---|
| `VAVOO_AUDIO_LANGUAGE_FILTER_ENABLED` | `true` | Enables preferred/blocked audio-language policy. |
| `VAVOO_AUDIO_PREFERRED_LANGUAGES` | `fra,fre,fr` | Preferred languages. `fr`, `fra` and `fre` normalize to French. |
| `VAVOO_AUDIO_BLOCKED_LANGUAGES` | `eng,en` | Blocked languages when the same variant does not declare any preferred language. |

With the defaults:

- a variant declaring French is preferred;
- a variant declaring English without French is excluded from failover;
- a variant with unknown language remains usable as a fallback so a badly tagged stream is not lost;
- an already healthy active variant is not replaced merely because another variant has better technical quality.

The `/channel-groups` endpoint exposes the detected languages and policy result in each variant's `quality` metadata (`audio_languages`, `audio_language_class`, `audio_language_allowed`).

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
