import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node prefetch-hls-assets.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function replaceExactlyOnce(search, replacement, description) {
  const occurrences = source.split(search).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      description + ': expected exactly one match, found ' + occurrences
    );
  }

  source = source.replace(search, replacement);
}

replaceExactlyOnce(
  'const HLS_ASSET_FETCH_TIMEOUT_MS = 12000;',
  [
    'const HLS_ASSET_FETCH_TIMEOUT_MS = 12000;',
    'const HLS_PREFETCH_SEGMENT_COUNT = 2;',
    'const HLS_PREFETCH_TOTAL_TIMEOUT_MS = 40000;',
    'const hlsAssetInflight = new Map();'
  ].join('\n'),
  'HLS prefetch constants insertion'
);

replaceExactlyOnce(
  'async function proxyUpstreamUrl(req, res, upstreamUrl) {',
  `function getRecentHlsAssetUrls(streamUrl, playlist) {
    const assetUrls = [];

    for (const rawLine of String(playlist || '').split(/\\r?\\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        try {
            const parsed = new URL(line, streamUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                continue;
            }
            if (!/\\.(?:ts|m4s|aac|mp4)$/i.test(parsed.pathname)) {
                continue;
            }
            assetUrls.push(parsed.toString());
        } catch (error) {
            // EN: Ignore malformed playlist entries and keep serving the playlist.
            // FR : Ignore les entrées mal formées et continue de servir la playlist.
        }
    }

    return [...new Set(assetUrls)].slice(-HLS_PREFETCH_SEGMENT_COUNT);
}

function cacheHlsAsset(cacheKey, result) {
    if (
        result &&
        result.kind === 'asset' &&
        result.status === 200 &&
        result.body.length <= HLS_ASSET_MAX_CACHE_BYTES
    ) {
        cache.set(cacheKey, result, HLS_ASSET_CACHE_TTL_SECONDS);
        return true;
    }

    return false;
}

function startSharedHlsAssetFetch(
    req,
    upstreamUrl,
    parentSignal,
    upstreamLabel
) {
    const cacheKey = getHlsAssetCacheKey(upstreamUrl);
    const existing = hlsAssetInflight.get(cacheKey);
    if (existing) {
        return { cacheKey, promise: existing, shared: true };
    }

    let promise;
    promise = fetchHlsResourceWithRetries(
        req,
        upstreamUrl,
        parentSignal,
        upstreamLabel
    ).finally(() => {
        if (hlsAssetInflight.get(cacheKey) === promise) {
            hlsAssetInflight.delete(cacheKey);
        }
    });

    hlsAssetInflight.set(cacheKey, promise);
    return { cacheKey, promise, shared: false };
}

function prefetchPlaylistSegments(req, streamUrl, playlist, channelName) {
    for (const assetUrl of getRecentHlsAssetUrls(streamUrl, playlist)) {
        const cacheKey = getHlsAssetCacheKey(assetUrl);
        if (cache.get(cacheKey) || hlsAssetInflight.has(cacheKey)) {
            continue;
        }

        const upstreamLabel = describeHlsAssetUrl(assetUrl);
        const parentSignal = AbortSignal.timeout(
            HLS_PREFETCH_TOTAL_TIMEOUT_MS
        );
        const started = startSharedHlsAssetFetch(
            req,
            assetUrl,
            parentSignal,
            upstreamLabel
        );

        void started.promise.then((result) => {
            if (cacheHlsAsset(started.cacheKey, result)) {
                console.log(
                    '[vavoo] hls asset prefetched "' + upstreamLabel +
                    '" channel="' + channelName + '" bytes=' +
                    result.body.length
                );
            }
        }).catch((error) => {
            console.log(
                '[vavoo] hls asset prefetch skipped "' + upstreamLabel +
                '" channel="' + channelName + '" error="' +
                error.message + '"'
            );
        });
    }
}

async function proxyUpstreamUrl(req, res, upstreamUrl) {`,
  'HLS prefetch helpers insertion'
);

replaceExactlyOnce(
  `    req.socket.on('close', function () {
        controller.abort();
    });

    try {`,
  `    const onSocketClose = function () {
        controller.abort();
    };
    req.socket.once('close', onSocketClose);

    try {`,
  'socket close listener replacement'
);

replaceExactlyOnce(
  `        const result = await fetchHlsResourceWithRetries(
            req,
            upstreamUrl,
            controller.signal,
            upstreamLabel
        );`,
  `        let result;
        const inflight = hlsAssetInflight.get(cacheKey);
        if (inflight) {
            console.log(
                '[' + connId + '] hls asset awaiting prefetch "' +
                upstreamLabel + '"'
            );
            try {
                result = await inflight;
            } catch (error) {
                console.log(
                    '[vavoo] hls asset prefetch fallback "' +
                    upstreamLabel + '" error="' + error.message + '"'
                );
            }
        }

        if (!result) {
            const started = startSharedHlsAssetFetch(
                req,
                upstreamUrl,
                controller.signal,
                upstreamLabel
            );
            result = await started.promise;
        }`,
  'shared HLS asset fetch replacement'
);

replaceExactlyOnce(
  `        if (
            canUseAssetCache &&
            result.status === 200 &&
            result.body.length <= HLS_ASSET_MAX_CACHE_BYTES
        ) {
            cache.set(cacheKey, result, HLS_ASSET_CACHE_TTL_SECONDS);
        }`,
  `        if (canUseAssetCache) {
            cacheHlsAsset(cacheKey, result);
        }`,
  'HLS asset cache helper replacement'
);

replaceExactlyOnce(
  `        if (!res.headersSent) {
            res.status(502).send('upstream proxy error: ' + error.message);
        }
    }
}`,
  `        if (!res.headersSent) {
            res.status(502).send('upstream proxy error: ' + error.message);
        }
    } finally {
        req.socket.removeListener('close', onSocketClose);
    }
}`,
  'socket close listener cleanup insertion'
);

replaceExactlyOnce(
  `        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            upstream.playlist
        );
        const debugInfo = getPlaylistDebugInfo(upstream.playlist);`,
  `        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            upstream.playlist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            channel.name
        );
        const debugInfo = getPlaylistDebugInfo(upstream.playlist);`,
  'renewable playlist prefetch trigger insertion'
);

replaceExactlyOnce(
  'console.log(`[${connId}] hls proxy opened "${describeUpstreamUrl(parsedUrl.toString())}"`);',
  'console.log(`[${connId}] hls proxy request "${describeHlsAssetUrl(parsedUrl.toString())}"`);',
  'signed HLS URL log shortening'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched HLS prefetch and socket-listener cleanup: ' + target
);
