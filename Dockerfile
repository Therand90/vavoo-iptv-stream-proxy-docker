# syntax=docker/dockerfile:1.7

# EN: Pin the multi-platform Node.js base image by digest; Dependabot keeps it current.
# FR : Épingle l’image Node.js multiplateforme par digest ; Dependabot le maintient à jour.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS build

ARG UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy
ARG UPSTREAM_REF

WORKDIR /src

COPY patches/extend-catalog-cache.mjs /tmp/extend-catalog-cache.mjs
COPY patches/renew-hourly-hls.mjs /tmp/renew-hourly-hls.mjs
COPY patches/harden-hls-retries.mjs /tmp/harden-hls-retries.mjs
COPY patches/harden-hls-assets.mjs /tmp/harden-hls-assets.mjs
COPY patches/prefetch-hls-assets.mjs /tmp/prefetch-hls-assets.mjs
COPY patches/configure-hls-tuning.mjs /tmp/configure-hls-tuning.mjs
COPY patches/harden-hls-playlist-latency.mjs /tmp/harden-hls-playlist-latency.mjs
COPY patches/hedge-hls-prefetch.mjs /tmp/hedge-hls-prefetch.mjs
COPY patches/sign-hls-proxy-urls.mjs /tmp/sign-hls-proxy-urls.mjs
COPY patches/group-logical-channels.mjs /tmp/group-logical-channels.mjs
COPY patches/detect-looping-variants.mjs /tmp/detect-looping-variants.mjs
COPY patches/fix-logical-timeline.mjs /tmp/fix-logical-timeline.mjs
COPY patches/rank-logical-variants-v2.mjs /tmp/rank-logical-variants.mjs
COPY patches/filter-logical-audio-language.mjs /tmp/filter-logical-audio-language.mjs
COPY patches/fix-logical-audio-hls-media.mjs /tmp/fix-logical-audio-hls-media.mjs
COPY patches/stabilize-logical-active-variant.mjs /tmp/stabilize-logical-active-variant.mjs
COPY patches/persist-logical-state.mjs /tmp/persist-logical-state.mjs
COPY patches/harden-logical-source-selection.mjs /tmp/harden-logical-source-selection.mjs
COPY patches/delay-hls-live-edge.mjs /tmp/delay-hls-live-edge.mjs

RUN test -n "${UPSTREAM_REF}" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gzip tar \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --silent --show-error --location \
       "https://github.com/${UPSTREAM_REPO}/archive/${UPSTREAM_REF}.tar.gz" \
       | tar --extract --gzip --strip-components=1 --directory /src \
    && test -f package.json \
    && test -f package-lock.json \
    && node /tmp/extend-catalog-cache.mjs /src/index.js \
    && node /tmp/renew-hourly-hls.mjs /src/index.js \
    && node /tmp/harden-hls-retries.mjs /src/index.js \
    && node /tmp/harden-hls-assets.mjs /src/index.js \
    && node /tmp/prefetch-hls-assets.mjs /src/index.js \
    && node /tmp/configure-hls-tuning.mjs /src/index.js \
    && node /tmp/harden-hls-playlist-latency.mjs /src/index.js \
    && node /tmp/hedge-hls-prefetch.mjs /src/index.js \
    && node /tmp/sign-hls-proxy-urls.mjs /src/index.js \
    && node /tmp/group-logical-channels.mjs /src/index.js \
    && node /tmp/detect-looping-variants.mjs /src/index.js \
    && node /tmp/fix-logical-timeline.mjs /src/index.js \
    && node /tmp/rank-logical-variants.mjs /src/index.js \
    && node /tmp/filter-logical-audio-language.mjs /src/index.js \
    && node /tmp/fix-logical-audio-hls-media.mjs /src/index.js \
    && node /tmp/stabilize-logical-active-variant.mjs /src/index.js \
    && node /tmp/persist-logical-state.mjs /src/index.js \
    && node /tmp/harden-logical-source-selection.mjs /src/index.js \
    && node /tmp/delay-hls-live-edge.mjs /src/index.js \
    && grep -q "hls asset prefetched" /src/index.js \
    && grep -q "removeListener('close', onSocketClose)" /src/index.js \
    && grep -q "VAVOO_HLS_PREFETCH_SEGMENT_COUNT" /src/index.js \
    && grep -q "VAVOO_HLS_PREFETCH_HEDGE_DELAY_MS" /src/index.js \
    && grep -q "hls asset hedge won" /src/index.js \
    && grep -q "VAVOO_PLAYLIST_HEDGE_DELAY_MS" /src/index.js \
    && grep -q "VAVOO_PLAYLIST_FAST_FALLBACK_MS" /src/index.js \
    && grep -q "playlist hedge won" /src/index.js \
    && grep -q "serving last valid playlist quickly" /src/index.js \
    && grep -q "invalid hls proxy signature" /src/index.js \
    && grep -q "channels-grouped.m3u8" /src/index.js \
    && grep -q "logical variant selected" /src/index.js \
    && grep -q "logical loop confirmed" /src/index.js \
    && grep -q "logical timeline discontinuity" /src/index.js \
    && grep -q "lastSourceFirst" /src/index.js \
    && grep -q "logical quality ranking" /src/index.js \
    && grep -q "logical quality probe" /src/index.js \
    && grep -q "logical audio language blocked every variant" /src/index.js \
    && grep -q "audio_language_class" /src/index.js \
    && grep -Fq "(?:^|[:,])TYPE=AUDIO" /src/index.js \
    && grep -q "VAVOO_ACTIVE_STALE_GRACE_SECONDS" /src/index.js \
    && grep -q "logical active stale grace" /src/index.js \
    && grep -q "Quality-cache expiry alone must not unstick" /src/index.js \
    && grep -q "VAVOO_LOGICAL_STATE_FILE" /src/index.js \
    && grep -q "logical state restored" /src/index.js \
    && grep -q "persistLogicalVariantState" /src/index.js \
    && grep -q "VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS" /src/index.js \
    && grep -q "logical playlist stalled" /src/index.js \
    && grep -q "logical state keeps preferred variant" /src/index.js \
    && grep -q "VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS" /src/index.js \
    && grep -q "X-Therand-Vavoo-Live-Edge-Delay-Segments" /src/index.js \
    && grep -q "safety_delay=" /src/index.js \
    && npm ci --omit=dev \
    && node --check index.js \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy
ARG UPSTREAM_REF=unknown

LABEL org.opencontainers.image.title="VAVOO IPTV Stream Proxy" \
      org.opencontainers.image.description="Validated Docker wrapper with renewable and resilient HLS playback patches" \
      org.opencontainers.image.source="https://github.com/Therand90/vavoo-iptv-stream-proxy-docker" \
      org.opencontainers.image.documentation="https://github.com/Therand90/vavoo-iptv-stream-proxy-docker#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Therand90" \
      io.therand.upstream.repository="https://github.com/${UPSTREAM_REPO}" \
      io.therand.upstream.revision="${UPSTREAM_REF}"

ENV NODE_ENV=production \
    VAVOO_CHANNELS_CACHE_TTL_SECONDS=21600 \
    VAVOO_STREAM_URL_TTL_SECONDS=3000 \
    VAVOO_PLAYLIST_CACHE_TTL_SECONDS=300 \
    VAVOO_PLAYLIST_HEDGE_DELAY_MS=1000 \
    VAVOO_PLAYLIST_FAST_FALLBACK_MS=3000 \
    VAVOO_HLS_ASSET_CACHE_TTL_SECONDS=120 \
    VAVOO_HLS_ASSET_MAX_CACHE_BYTES=12582912 \
    VAVOO_HLS_PREFETCH_SEGMENT_COUNT=2 \
    VAVOO_HLS_PREFETCH_HEDGE_DELAY_MS=1500 \
    VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS=2 \
    VAVOO_VARIANT_QUARANTINE_SECONDS=300 \
    VAVOO_ACTIVE_STALE_GRACE_SECONDS=8 \
    VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS=20 \
    VAVOO_LOOP_DETECTION_ENABLED=true \
    VAVOO_LOOP_SIMILARITY_THRESHOLD=0.70 \
    VAVOO_LOOP_MIN_COMMON_NALS=100 \
    VAVOO_LOOP_CONFIRMATIONS=2 \
    VAVOO_LOOP_HISTORY_SEGMENTS=8 \
    VAVOO_LOOP_QUARANTINE_SECONDS=86400 \
    VAVOO_QUALITY_RANKING_ENABLED=true \
    VAVOO_QUALITY_CACHE_SECONDS=1800 \
    VAVOO_AUDIO_LANGUAGE_FILTER_ENABLED=true \
    VAVOO_AUDIO_PREFERRED_LANGUAGES=fra,fre,fr \
    VAVOO_AUDIO_BLOCKED_LANGUAGES=eng,en \
    VAVOO_LOGICAL_STATE_FILE=/data/logical-state.json

WORKDIR /app

COPY --from=build --chown=node:node /src /app

# EN: Writable named volume target used only for small persistent logical-channel state.
# FR : Cible de volume nommée inscriptible réservée au petit état persistant des chaînes logiques.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8888/', { signal: AbortSignal.timeout(8000) }).then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

ENTRYPOINT ["node", "index.js"]

CMD ["--http-host", "0.0.0.0", "--http-port", "8888", "--vavoo-language", "en", "--vavoo-region", "US", "--vavoo-url-list", "both"]
