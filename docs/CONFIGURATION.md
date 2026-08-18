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
| `VAVOO_PLAYLIST_HEDGE_DELAY_MS` | `1000` | Delay before starting one backup playlist request when the primary request is still pending during established playback. |
| `VAVOO_PLAYLIST_FAST_FALLBACK_MS` | `3000` | Total fresh-playlist budget when a last-valid playlist is already cached. Once exceeded, the proxy immediately serves the cached playlist and invalidates the signed URL for the next poll. Set to `0` to restore the legacy retry path for this case. |
| `VAVOO_HLS_ASSET_CACHE_TTL_SECONDS` | `120` | Memory-cache lifetime for successfully downloaded HLS media assets. The 120 s default leaves enough headroom for prefetched segments to remain cached until a player deliberately kept behind the live edge consumes them. |
| `VAVOO_HLS_ASSET_MAX_CACHE_BYTES` | `12582912` | Maximum size of one cached media asset, in bytes. The default is 12 MiB. |
| `VAVOO_HLS_PREFETCH_SEGMENT_COUNT` | `2` | Number of most recent media segments prefetched from each renewed playlist. Set to `0` to disable prefetching. |
| `VAVOO_HLS_PREFETCH_HEDGE_DELAY_MS` | `1500` | Delay before starting a backup media request when the player is waiting on a still-running segment prefetch. |
| `VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS` | `2` | Number of prefetched segments deliberately hidden from consumers so they remain behind the live edge. The effective delay is reduced automatically when the playlist is too short or the configured prefetch depth is smaller. |
| `VAVOO_VARIANT_QUARANTINE_SECONDS` | `300` | Temporary quarantine applied to a variant after an ordinary fetch error or a persistently stale playlist. |
| `VAVOO_ACTIVE_STALE_GRACE_SECONDS` | `8` | Grace period during which an already active logical variant remains selected when only its fresh playlist is briefly unavailable. The shorter default still tolerates a transient miss but allows failover before Kodi reaches its EOF threshold. Set to `0` to disable the grace period. |
| `VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS` | `20` | Maximum time a fresh HTTP-200 media playlist may keep returning without advancing its newest media segment. Once exceeded, the variant is treated as stalled and failover starts. Set to `0` to disable this watchdog. |
| `VAVOO_LOOP_DETECTION_ENABLED` | `true` | Enables the lightweight MPEG-TS/H.264 video-loop detector. |
| `VAVOO_LOOP_SIMILARITY_THRESHOLD` | `0.70` | Minimum similarity used by video-repeat detection. |
| `VAVOO_LOOP_MIN_COMMON_NALS` | `100` | Minimum number of common NAL units required before a repeat is meaningful. |
| `VAVOO_LOOP_CONFIRMATIONS` | `2` | Consecutive detections required before quarantining a variant. |
| `VAVOO_LOOP_HISTORY_SEGMENTS` | `8` | Number of historical segments kept when looking for repetition. |
| `VAVOO_LOOP_QUARANTINE_SECONDS` | `86400` | Quarantine duration after a video loop is confirmed. One day prevents a structurally looping source from polluting every failover while still allowing it to be retried the next day. |
| `VAVOO_QUALITY_RANKING_ENABLED` | `true` | Ranks variants by resolution, frame rate, bitrate and loop signals when no healthy active variant exists. Expiry of cached measurements alone does not trigger re-ranking of an already active variant. |
| `VAVOO_QUALITY_CACHE_SECONDS` | `1800` | Lifetime of cached quality and audio-language measurements for a variant. |
| `VAVOO_LOGICAL_STATE_FILE` | `/data/logical-state.json` | Small persistent JSON state containing the last healthy active variant and unexpired variant quarantines. The supplied Compose and LibreELEC manager mount `/data` on a named Docker volume. Set this to an empty value only to disable persistence intentionally. |
| `VAVOO_HLS_PROXY_SECRET` | generated at startup | Optional persistent secret used to sign internal `/hls-proxy` URLs. Leave empty for a single container. Set the same strong secret on every replica when several instances must accept one another's signed URLs. |

During established playback, a playlist that returns normally before `VAVOO_PLAYLIST_HEDGE_DELAY_MS` creates no extra request. If it remains pending, exactly one backup request is started. When neither the primary nor its backup returns a fresh playlist before `VAVOO_PLAYLIST_FAST_FALLBACK_MS`, the proxy serves the last valid cached playlist instead of letting Kodi wait for the historical multi-second timeout path. The signed stream URL is invalidated so the next poll starts from a fresh resolution.

The `VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS` safety buffer is applied after the upstream playlist is downloaded but before it is presented to Kodi or any other consumer of the proxy. With the default value `2`, the two newest segments remain hidden while they are being prefetched; a six-segment live playlist therefore normally exposes four. When one of those hidden segments becomes visible on a later poll, it has normally already been fully downloaded into the media cache. The 120-second TTL prevents a prefetched segment from expiring just before consumption when the player remains several segments behind the live edge. VOD playlists ending with `#EXT-X-ENDLIST` are never delayed, and the proxy always keeps at least three segments visible.

The same delay protects recording consumers when they use the proxy HLS endpoints. Recordings therefore benefit from the same prefetch/cache margin as live playback. The tradeoff is a small content latency versus wall-clock time, so strict recording boundaries should account for the configured segment delay. Scheduling a margin before and after the target program naturally absorbs it.

For an already active logical channel, a temporarily stale fallback does not immediately switch variants: `VAVOO_ACTIVE_STALE_GRACE_SECONDS` keeps the active source selected for a short window. A persistent failure beyond the grace window still follows the normal quarantine and failover behavior. Loop detection remains independent: a genuinely confirmed loop still triggers the long loop quarantine.

An HTTP 200 response is no longer enough to consider a logical source healthy: the proxy also tracks the newest media segment in each fresh logical playlist. If that segment remains unchanged for `VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS`, the variant's signed URL and playlist cache are invalidated, the ordinary quarantine is applied, and the same request immediately tries the next variant. This covers sources that stay reachable while repeating a frozen playlist until Kodi abandons playback.

A confirmed video loop receives a distinct, much longer quarantine: 24 hours by default. That quarantine is persisted in `VAVOO_LOGICAL_STATE_FILE`, so maintenance or container recreation does not immediately make a known-looping variant eligible again.

Logical-channel state is persistent by default. When a healthy variant becomes active, its stable variant ID and name are saved to `VAVOO_LOGICAL_STATE_FILE`; future container recreations/reboots restore it before quality ranking runs. Unexpired quarantines are stored in the same file. Quality measurements themselves remain short-lived runtime data. In addition, a temporary fallback explicitly detected as a foreign language (`other`) may be used during the current session but does not overwrite an existing saved preference, so a temporary Portuguese fallback cannot replace a previously remembered good startup source.

## Logical-variant audio language

The proxy reuses the same playlists and media segments that are already downloaded for quality ranking. It first inspects HLS `#EXT-X-MEDIA` declarations and then ISO-639 descriptors in MPEG-TS PMT tables. No additional media download is required when a quality probe is already running.

| Variable | Default | Purpose |
|---|---:|---|
| `VAVOO_AUDIO_LANGUAGE_FILTER_ENABLED` | `true` | Enables preferred/blocked audio-language policy. |
| `VAVOO_AUDIO_PREFERRED_LANGUAGES` | `fra,fre,fr` | Preferred languages. `fr`, `fra` and `fre` normalize to French. |
| `VAVOO_AUDIO_BLOCKED_LANGUAGES` | `eng,en` | Blocked languages when the same variant does not declare any preferred language. |

With the defaults:

- a variant declaring French is preferred;
- a variant with unknown language metadata ranks ahead of a variant explicitly detected in another language, because unknown may simply mean the stream failed to tag its audio correctly;
- a known foreign-language variant remains available as a fallback when no better option exists;
- a variant declaring English without French is excluded from failover;
- an already healthy active variant is not replaced merely because another variant has better technical quality or because cached quality measurements have just expired.

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
