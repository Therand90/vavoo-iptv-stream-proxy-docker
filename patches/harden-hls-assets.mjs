import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-hls-assets.mjs <index.js>');
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
  'const PLAYLIST_REFRESH_RETRY_DELAYS_MS = [0, 250, 750];',
  [
    'const PLAYLIST_REFRESH_RETRY_DELAYS_MS = [0, 250, 750];',
    "const HLS_ASSET_CACHE_PREFIX = 'vavoo_hls_asset:';",
    'const HLS_ASSET_CACHE_TTL_SECONDS = 45;',
    'const HLS_ASSET_MAX_CACHE_BYTES = 12 * 1024 * 1024;',
    'const HLS_ASSET_RETRY_DELAYS_MS = [0, 150, 400];',
    'const HLS_ASSET_FETCH_TIMEOUT_MS = 12000;'
  ].join('\n'),
  'HLS asset resilience constants insertion'
);

const startMarker = 'async function proxyUpstreamUrl(req, res, upstreamUrl) {';
const endMarker = "\n\napp.get('/', function (req, res) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error('unable to locate proxyUpstreamUrl in patched upstream');
}

const replacement = `function getHlsAssetCacheKey(upstreamUrl) {
    return HLS_ASSET_CACHE_PREFIX + upstreamUrl;
}

function describeHlsAssetUrl(upstreamUrl) {
    try {
        const parsed = new URL(upstreamUrl);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const fileName = parts.length > 0 ? parts[parts.length - 1] : 'resource';
        return parsed.hostname + '/.../' + fileName;
    } catch (error) {
        return 'invalid-upstream-url';
    }
}

function copyBufferedAssetHeaders(res, asset) {
    if (asset.contentType) {
        res.setHeader('Content-Type', asset.contentType);
    }
    if (asset.cacheControl) {
        res.setHeader('Cache-Control', asset.cacheControl);
    }
    if (asset.etag) {
        res.setHeader('ETag', asset.etag);
    }
    if (asset.lastModified) {
        res.setHeader('Last-Modified', asset.lastModified);
    }
    if (asset.acceptRanges) {
        res.setHeader('Accept-Ranges', asset.acceptRanges);
    }
    if (asset.contentRange) {
        res.setHeader('Content-Range', asset.contentRange);
    }
}

function sendBufferedAsset(res, asset) {
    copyBufferedAssetHeaders(res, asset);
    res.status(asset.status || 200).send(asset.body);
}

async function fetchHlsResourceOnce(req, upstreamUrl, parentSignal) {
    const signal = AbortSignal.any([
        parentSignal,
        AbortSignal.timeout(HLS_ASSET_FETCH_TIMEOUT_MS)
    ]);
    const upstream = await fetch(upstreamUrl, {
        signal,
        headers: getStreamHeaders(req)
    });

    if (!upstream.ok || !upstream.body) {
        throw new Error('upstream returned HTTP ' + upstream.status);
    }

    const contentType = upstream.headers.get('content-type');
    if (isM3u8Response(upstreamUrl, contentType)) {
        return {
            kind: 'playlist',
            status: upstream.status,
            contentType,
            playlist: await upstream.text()
        };
    }

    return {
        kind: 'asset',
        status: upstream.status,
        contentType,
        cacheControl: upstream.headers.get('cache-control'),
        etag: upstream.headers.get('etag'),
        lastModified: upstream.headers.get('last-modified'),
        acceptRanges: upstream.headers.get('accept-ranges'),
        contentRange: upstream.headers.get('content-range'),
        body: Buffer.from(await upstream.arrayBuffer())
    };
}

async function fetchHlsResourceWithRetries(
    req,
    upstreamUrl,
    parentSignal,
    upstreamLabel
) {
    let lastError;

    for (let attempt = 0; attempt < HLS_ASSET_RETRY_DELAYS_MS.length; attempt += 1) {
        const delayMs = HLS_ASSET_RETRY_DELAYS_MS[attempt];
        if (delayMs > 0) {
            await sleepMs(delayMs);
        }

        if (parentSignal.aborted) {
            throw new Error('client connection closed');
        }

        try {
            const result = await fetchHlsResourceOnce(
                req,
                upstreamUrl,
                parentSignal
            );
            if (attempt > 0) {
                console.log(
                    '[vavoo] hls asset recovered "' + upstreamLabel +
                    '" attempt=' + (attempt + 1)
                );
            }
            return result;
        } catch (error) {
            lastError = error;
            if (parentSignal.aborted) {
                throw error;
            }
            console.log(
                '[vavoo] hls asset retry "' + upstreamLabel +
                '" attempt=' + (attempt + 1) + '/' +
                HLS_ASSET_RETRY_DELAYS_MS.length +
                ' error="' + error.message + '"'
            );
        }
    }

    throw lastError;
}

async function proxyUpstreamUrl(req, res, upstreamUrl) {
    const connId = String(req.socket.remoteAddress);
    const controller = new AbortController();
    const upstreamLabel = describeHlsAssetUrl(upstreamUrl);
    const cacheKey = getHlsAssetCacheKey(upstreamUrl);
    const canUseAssetCache = !req.headers.range;

    req.socket.on('close', function () {
        controller.abort();
    });

    try {
        if (canUseAssetCache) {
            const cachedAsset = cache.get(cacheKey);
            if (cachedAsset) {
                console.log(
                    '[' + connId + '] hls asset cache hit "' +
                    upstreamLabel + '"'
                );
                sendBufferedAsset(res, cachedAsset);
                return;
            }
        }

        console.log(
            '[' + connId + '] hls proxy opened "' + upstreamLabel + '"'
        );
        const result = await fetchHlsResourceWithRetries(
            req,
            upstreamUrl,
            controller.signal,
            upstreamLabel
        );

        if (result.kind === 'playlist') {
            const rewrittenPlaylist = rewriteM3u8Playlist(
                req,
                upstreamUrl,
                result.playlist
            );
            const debugInfo = getPlaylistDebugInfo(result.playlist);
            console.log(
                '[' + connId + '] hls playlist "' + upstreamLabel +
                '" status=' + result.status +
                ' sequence=' + debugInfo.sequence +
                ' entries=' + debugInfo.segments
            );
            setPlaylistHeaders(res);
            res.send(rewrittenPlaylist);
            return;
        }

        if (
            canUseAssetCache &&
            result.status === 200 &&
            result.body.length <= HLS_ASSET_MAX_CACHE_BYTES
        ) {
            cache.set(cacheKey, result, HLS_ASSET_CACHE_TTL_SECONDS);
        }

        console.log(
            '[' + connId + '] hls asset "' + upstreamLabel +
            '" status=' + result.status +
            ' type="' + (result.contentType || 'unknown') + '"' +
            ' bytes=' + result.body.length
        );
        sendBufferedAsset(res, result);
    } catch (error) {
        if (controller.signal.aborted) {
            console.log(
                '[' + connId + '] hls proxy ended "' + upstreamLabel + '"'
            );
            return;
        }

        console.log(
            '[' + connId + '] hls proxy error "' + upstreamLabel +
            '": ' + error.message
        );
        if (!res.headersSent) {
            res.status(502).send('upstream proxy error: ' + error.message);
        }
    }
}`;

source = source.slice(0, start) + replacement + source.slice(end);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched HLS asset retries and short-lived cache: ' + target
);
