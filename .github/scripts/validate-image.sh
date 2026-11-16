#!/usr/bin/env bash
# Shared full smoke-test suite for native amd64 and arm64 GitHub Actions runners.
set -euo pipefail
: "${LOCAL_IMAGE:?LOCAL_IMAGE must name a locally loaded Docker image}"
: "${EXPECTED_PLATFORM:?EXPECTED_PLATFORM must be linux/amd64 or linux/arm64}"
actual_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$LOCAL_IMAGE")"
if [[ "$actual_platform" != "$EXPECTED_PLATFORM" ]]; then
  echo "Wrong image architecture: expected $EXPECTED_PLATFORM, got $actual_platform" >&2
  exit 1
fi

set -euo pipefail

docker run --rm --entrypoint node "$LOCAL_IMAGE" -e '
  const fs = require("node:fs");
  const source = fs.readFileSync("/app/index.js", "utf8");
  const required = [
    "CHANNELS_CACHE_TTL_SECONDS",
    "STREAM_URL_TTL_SECONDS",
    "VAVOO_PLAYLIST_CACHE_TTL_SECONDS",
    "VAVOO_HLS_ASSET_CACHE_TTL_SECONDS",
    "VAVOO_HLS_ASSET_MAX_CACHE_BYTES",
    "VAVOO_HLS_PREFETCH_SEGMENT_COUNT",
    "HLS_PROXY_SECRET",
    "invalid hls proxy signature",
    "/hls-channel/:id",
    "renewable hls master",
    "Buffer.from(await upstream.arrayBuffer())",
    "removeListener(",
    "onSocketClose",
    "/channels-grouped.m3u8",
    "/hls-group/:id",
    "logical loop confirmed",
    "logical timeline discontinuity",
    "lastSourceFirst"
  ];
  for (const marker of required) {
    if (!source.includes(marker)) {
      console.error(`missing patch marker: ${marker}`);
      process.exit(1);
    }
  }
  if (source.includes("cache.set(CHANNELS_CACHE_KEY, channels, 300);")) {
    process.exit(1);
  }
'

catalog_ttl="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_CHANNELS_CACHE_TTL_SECONDS"')"
stream_ttl="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_STREAM_URL_TTL_SECONDS"')"
playlist_ttl="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_PLAYLIST_CACHE_TTL_SECONDS"')"
asset_ttl="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_HLS_ASSET_CACHE_TTL_SECONDS"')"
asset_max="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_HLS_ASSET_MAX_CACHE_BYTES"')"
prefetch_count="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_HLS_PREFETCH_SEGMENT_COUNT"')"
loop_enabled="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_LOOP_DETECTION_ENABLED"')"
loop_threshold="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_LOOP_SIMILARITY_THRESHOLD"')"
loop_confirmations="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_LOOP_CONFIRMATIONS"')"
loop_quarantine="$(docker run --rm --entrypoint sh "$LOCAL_IMAGE" -c 'printf %s "$VAVOO_LOOP_QUARANTINE_SECONDS"')"

test "$catalog_ttl" = "21600"
test "$stream_ttl" = "3000"
test "$playlist_ttl" = "300"
test "$asset_ttl" = "120"
test "$asset_max" = "12582912"
test "$prefetch_count" = "2"
test "$loop_enabled" = "true"
test "$loop_threshold" = "0.70"
test "$loop_confirmations" = "2"
test "$loop_quarantine" = "86400"

set -euo pipefail

container="vavoo-smoke-${GITHUB_RUN_ID}"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach \
  --name "$container" \
  --publish 127.0.0.1:18888:8888 \
  "$LOCAL_IMAGE" >/dev/null

ready=0
for _ in $(seq 1 45); do
  if curl --fail --silent --show-error \
    http://127.0.0.1:18888/countries \
    --output /tmp/vavoo-countries.json \
    && grep --quiet '"France"' /tmp/vavoo-countries.json; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "The catalog did not become ready." >&2
  docker logs "$container" >&2 || true
  exit 1
fi

unsigned_status="$(curl --silent --show-error \
  --output /tmp/vavoo-unsigned-proxy.txt \
  --write-out '%{http_code}' \
  --get \
  --data-urlencode 'url=https://example.com/test.m3u8' \
  http://127.0.0.1:18888/hls-proxy)"
test "$unsigned_status" = "403"
grep --quiet 'invalid hls proxy signature' /tmp/vavoo-unsigned-proxy.txt

curl --fail --silent --show-error \
  "http://127.0.0.1:18888/channels.m3u8?country=France" \
  --output /tmp/vavoo-france.m3u8

grep --quiet '^#EXTM3U' /tmp/vavoo-france.m3u8
grep --quiet '^#EXTINF' /tmp/vavoo-france.m3u8
grep --quiet '/stream/' /tmp/vavoo-france.m3u8

curl --fail --silent --show-error \
  "http://127.0.0.1:18888/channels-grouped.m3u8?country=France" \
  --output /tmp/vavoo-france-grouped.m3u8

grep --quiet '^#EXTM3U' /tmp/vavoo-france-grouped.m3u8
grep --quiet '^#EXTINF' /tmp/vavoo-france-grouped.m3u8
grep --quiet '/stream-group/' /tmp/vavoo-france-grouped.m3u8

raw_count="$(grep -c '^#EXTINF:' /tmp/vavoo-france.m3u8)"
grouped_count="$(grep -c '^#EXTINF:' /tmp/vavoo-france-grouped.m3u8)"
test "$grouped_count" -gt 0
test "$grouped_count" -le "$raw_count"

curl --fail --silent --show-error \
  "http://127.0.0.1:18888/channel-groups?country=France" \
  --output /tmp/vavoo-france-groups.json
grep --quiet '"variant_count"' /tmp/vavoo-france-groups.json

stream_url="$(awk '/\/stream\// { print; exit }' /tmp/vavoo-france.m3u8)"
stream_url="${stream_url%%|*}"
test -n "$stream_url"

curl --fail --silent --show-error \
  --user-agent 'VAVOO/2.6' \
  "$stream_url" \
  --output /tmp/vavoo-master.m3u8

grep --quiet '^#EXTM3U' /tmp/vavoo-master.m3u8
grep --quiet '/hls-channel/' /tmp/vavoo-master.m3u8

logical_stream_url="$(awk '/\/stream-group\// { print; exit }' /tmp/vavoo-france-grouped.m3u8)"
test -n "$logical_stream_url"
curl --fail --silent --show-error \
  --user-agent 'VAVOO/2.6' \
  "$logical_stream_url" \
  --output /tmp/vavoo-logical-master.m3u8
grep --quiet '^#EXTM3U' /tmp/vavoo-logical-master.m3u8
grep --quiet '/hls-group/' /tmp/vavoo-logical-master.m3u8
