import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node delay-hls-live-edge.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function replaceExactly(search, replacement, expected, description) {
  const occurrences = source.split(search).length - 1;

  if (occurrences !== expected) {
    throw new Error(
      description + ': expected exactly ' + expected +
      ' match(es), found ' + occurrences
    );
  }

  source = source.split(search).join(replacement);
}

function replaceExactlyOnce(search, replacement, description) {
  replaceExactly(search, replacement, 1, description);
}

replaceExactlyOnce(
  'async function proxyUpstreamUrl(req, res, upstreamUrl) {',
  `const HLS_LIVE_EDGE_DELAY_SEGMENTS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS || '2',
        10
    );
    return Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 6)
        : 2;
})();
const HLS_LIVE_EDGE_MIN_VISIBLE_SEGMENTS = 3;

function applyHlsLiveEdgeSafetyDelay(
    playlist,
    requestedDelaySegments = HLS_LIVE_EDGE_DELAY_SEGMENTS
) {
    const original = String(playlist || '');
    const lines = original.split(/\\r?\\n/);
    const trimmedLines = lines.map((line) => line.trim());

    if (
        HLS_LIVE_EDGE_DELAY_SEGMENTS < 1 ||
        HLS_PREFETCH_SEGMENT_COUNT < 1 ||
        trimmedLines.includes('#EXT-X-ENDLIST') ||
        !trimmedLines.some((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) ||
        !trimmedLines.some((line) => line.startsWith('#EXTINF:'))
    ) {
        return {
            playlist: original,
            hiddenSegments: 0,
            visibleSegments: 0,
            upstreamSegments: 0
        };
    }

    const segmentLineIndexes = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = trimmedLines[index];
        if (line && !line.startsWith('#')) {
            segmentLineIndexes.push(index);
        }
    }

    const upstreamSegments = segmentLineIndexes.length;
    const maxSafeDelay = Math.max(
        0,
        upstreamSegments - HLS_LIVE_EDGE_MIN_VISIBLE_SEGMENTS
    );
    const hiddenSegments = Math.min(
        requestedDelaySegments,
        HLS_PREFETCH_SEGMENT_COUNT,
        maxSafeDelay
    );

    if (hiddenSegments < 1) {
        return {
            playlist: original,
            hiddenSegments: 0,
            visibleSegments: upstreamSegments,
            upstreamSegments
        };
    }

    const visibleSegments = upstreamSegments - hiddenSegments;
    const lastVisibleLine = segmentLineIndexes[visibleSegments - 1];
    const delayedPlaylist = lines
        .slice(0, lastVisibleLine + 1)
        .join('\\n') + '\\n';

    return {
        playlist: delayedPlaylist,
        hiddenSegments,
        visibleSegments,
        upstreamSegments
    };
}

async function proxyUpstreamUrl(req, res, upstreamUrl) {`,
  'HLS live-edge safety helper insertion'
);

replaceExactlyOnce(
  `function sendBufferedAsset(res, asset) {
    copyBufferedAssetHeaders(res, asset);
    res.status(asset.status || 200).send(asset.body);
}`,
  `function sendBufferedAsset(res, asset) {
    copyBufferedAssetHeaders(res, asset);
    res.status(asset.status || 200).send(asset.body);
}

function getBufferedAssetRange(rangeHeader, totalLength) {
    const value = String(rangeHeader || '').trim();
    if (!value) {
        return { kind: 'full' };
    }

    const match = /^bytes=(\\d*)-(\\d*)$/i.exec(value);
    if (!match || (!match[1] && !match[2])) {
        return { kind: 'unsupported' };
    }

    let start;
    let end;

    if (!match[1]) {
        const suffixLength = Number.parseInt(match[2], 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return { kind: 'unsupported' };
        }
        if (totalLength <= 0) {
            return { kind: 'unsatisfiable' };
        }
        start = Math.max(0, totalLength - suffixLength);
        end = totalLength - 1;
    } else {
        start = Number.parseInt(match[1], 10);
        end = match[2]
            ? Number.parseInt(match[2], 10)
            : totalLength - 1;

        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            start < 0 ||
            start >= totalLength ||
            end < start
        ) {
            return { kind: 'unsatisfiable' };
        }

        end = Math.min(end, totalLength - 1);
    }

    return { kind: 'range', start, end };
}

function sendBufferedAssetForRequest(req, res, asset) {
    const range = getBufferedAssetRange(
        req.headers.range,
        asset.body.length
    );

    if (range.kind === 'unsupported') {
        return false;
    }

    if (range.kind === 'full') {
        sendBufferedAsset(res, asset);
        return true;
    }

    if (range.kind === 'unsatisfiable') {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Range', 'bytes */' + asset.body.length);
        res.status(416).end();
        return true;
    }

    const body = asset.body.subarray(range.start, range.end + 1);
    copyBufferedAssetHeaders(res, asset);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader(
        'Content-Range',
        'bytes ' + range.start + '-' + range.end + '/' + asset.body.length
    );
    res.setHeader('Content-Length', String(body.length));
    res.status(206).send(body);
    return true;
}`,
  'range-aware buffered HLS asset serving helpers'
);

replaceExactlyOnce(
  `    const canUseAssetCache = !req.headers.range;`,
  `    const rangeHeader = String(req.headers.range || '').trim();
    const canReadAssetCache = !rangeHeader || /^bytes=\\d*-\\d*$/i.test(rangeHeader);
    const canStoreAssetCache = !rangeHeader;`,
  'range-aware HLS asset cache flags'
);

replaceExactlyOnce(
  `        if (canUseAssetCache) {
            const cachedAsset = cache.get(cacheKey);
            if (cachedAsset) {
                console.log(
                    '[' + connId + '] hls asset cache hit "' +
                    upstreamLabel + '"'
                );
                sendBufferedAsset(res, cachedAsset);
                return;
            }
        }`,
  `        if (canReadAssetCache) {
            const cachedAsset = cache.get(cacheKey);
            if (cachedAsset) {
                const served = sendBufferedAssetForRequest(
                    req,
                    res,
                    cachedAsset
                );
                if (served) {
                    if (rangeHeader) {
                        console.log(
                            '[' + connId + '] hls asset range cache hit "' +
                            upstreamLabel + '" range="' + rangeHeader + '"'
                        );
                    } else {
                        console.log(
                            '[' + connId + '] hls asset cache hit "' +
                            upstreamLabel + '"'
                        );
                    }
                    return;
                }
            }
        }`,
  'range-aware HLS asset cache read'
);

replaceExactlyOnce(
  `        if (canUseAssetCache) {
            cacheHlsAsset(cacheKey, result);
        }`,
  `        if (canStoreAssetCache) {
            cacheHlsAsset(cacheKey, result);
        }`,
  'full-response-only HLS asset cache storage'
);

replaceExactlyOnce(
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
        );`,
  `        const liveEdge = applyHlsLiveEdgeSafetyDelay(
            upstream.playlist,
            upstream.stale ? 0 : HLS_LIVE_EDGE_DELAY_SEGMENTS
        );
        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            liveEdge.playlist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            channel.name
        );`,
  'renewable HLS live-edge delay insertion'
);

replaceExactlyOnce(
  `        const logicalPlaylist = rewriteLogicalPlaylistTimeline(
            group,
            upstream.variant,
            upstream.playlist
        );`,
  `        const liveEdge = applyHlsLiveEdgeSafetyDelay(
            upstream.playlist,
            upstream.stale ? 0 : HLS_LIVE_EDGE_DELAY_SEGMENTS
        );
        const logicalPlaylist = rewriteLogicalPlaylistTimeline(
            group,
            upstream.variant,
            liveEdge.playlist
        );`,
  'logical HLS live-edge delay insertion'
);

replaceExactly(
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments +
            ' safety_delay=' + liveEdge.hiddenSegments +
            ' visible=' + liveEdge.visibleSegments
        );
        res.setHeader(
            'X-Therand-Vavoo-Live-Edge-Delay-Segments',
            String(liveEdge.hiddenSegments)
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  2,
  'HLS live-edge diagnostics'
);

function parseRangeForSelfTest(value, length) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    return [Math.max(0, length - suffix), length - 1];
  }
  const start = Number.parseInt(match[1], 10);
  const end = match[2]
    ? Math.min(Number.parseInt(match[2], 10), length - 1)
    : length - 1;
  return [start, end];
}

const rangeA = parseRangeForSelfTest('bytes=0-', 1000);
const rangeB = parseRangeForSelfTest('bytes=100-199', 1000);
const rangeC = parseRangeForSelfTest('bytes=-100', 1000);
if (
  !rangeA || rangeA[0] !== 0 || rangeA[1] !== 999 ||
  !rangeB || rangeB[0] !== 100 || rangeB[1] !== 199 ||
  !rangeC || rangeC[0] !== 900 || rangeC[1] !== 999
) {
  throw new Error('buffered HLS range self-test failed');
}

if (
  !source.includes('hls asset range cache hit') ||
  !source.includes('upstream.stale ? 0 : HLS_LIVE_EDGE_DELAY_SEGMENTS')
) {
  throw new Error('HLS safety-buffer drain verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched HLS live-edge safety delay, stale-buffer drain and range-aware cache serving: ' +
  target + ' (default 2 segments)'
);
