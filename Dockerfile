# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

ARG UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy
ARG UPSTREAM_REF=main

WORKDIR /src

COPY patches/extend-catalog-cache.mjs /tmp/extend-catalog-cache.mjs
COPY patches/renew-hourly-hls.mjs /tmp/renew-hourly-hls.mjs
COPY patches/harden-hls-retries.mjs /tmp/harden-hls-retries.mjs

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gzip tar \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --silent --show-error --location \
       "https://github.com/${UPSTREAM_REPO}/archive/${UPSTREAM_REF}.tar.gz" \
       | tar --extract --gzip --strip-components=1 --directory /src \
    && test -f package.json \
    && node /tmp/extend-catalog-cache.mjs /src/index.js \
    && node /tmp/renew-hourly-hls.mjs /src/index.js \
    && node /tmp/harden-hls-retries.mjs /src/index.js \
    && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && node --check index.js \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy
ARG UPSTREAM_REF=unknown

LABEL org.opencontainers.image.title="VAVOO IPTV Stream Proxy" \
      org.opencontainers.image.description="Docker image built from Haehnchen/vavoo-iptv-stream-proxy" \
      org.opencontainers.image.source="https://github.com/Therand90/vavoo-iptv-stream-proxy-docker" \
      io.therand.upstream.repository="https://github.com/${UPSTREAM_REPO}" \
      io.therand.upstream.revision="${UPSTREAM_REF}"

ENV NODE_ENV=production \
    VAVOO_CHANNELS_CACHE_TTL_SECONDS=21600 \
    VAVOO_STREAM_URL_TTL_SECONDS=3000

WORKDIR /app

COPY --from=build --chown=node:node /src /app

USER node

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8888/', { signal: AbortSignal.timeout(8000) }).then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

ENTRYPOINT ["node", "index.js"]

CMD ["--http-host", "0.0.0.0", "--http-port", "8888", "--vavoo-language", "en", "--vavoo-region", "US", "--vavoo-url-list", "both"]
