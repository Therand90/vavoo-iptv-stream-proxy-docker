import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node fix-runtime-playback-edge-cases.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function replaceExactlyOnce(search, replacement, description) {
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(description + ': expected exactly one match, found ' + occurrences);
  }
  source = source.replace(search, replacement);
}

replaceExactlyOnce(
  `function sendBufferedAsset(res, asset) {
    copyBufferedAssetHeaders(res, asset);
    res.status(asset.status || 200).send(asset.body);
}

async function fetchHlsResourceOnce(req, upstreamUrl, parentSignal) {`,
  `function sendBufferedAsset(res, asset) {
    copyBufferedAssetHeaders(res, asset);
    res.status(asset.status || 200).send(asset.body);
}

function parseCachedHlsByteRange(rangeHeader, totalLength) {
    const value = String(rangeHeader || '').trim();
    const match = /^bytes=(\\d*)-(\\d*)$/i.exec(value);
    if (!match || !Number.isFinite(totalLength) || totalLength <= 0) {
        return null;
    }

    let start;
    let end;

    if (!match[1]) {
        const suffixLength = Number.parseInt(match[2], 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(0, totalLength - suffixLength);
        end = totalLength - 1;
    } else {
        start = Number.parseInt(match[1], 10);
        if (!Number.isFinite(start) || start < 0 || start >= totalLength) {
            return null;
        }

        if (!match[2]) {
            end = totalLength - 1;
        } else {
            end = Number.parseInt(match[2], 10);
            if (!Number.isFinite(end) || end < start) {
                return null;
            }
            end = Math.min(end, totalLength - 1);
        }
    }

    return { start, end };
}

function sendBufferedAssetForRequest(req, res, asset) {
    if (!req.headers.range) {
        sendBufferedAsset(res, asset);
        return true;
    }

    if (
        !asset ||
        (asset.status || 200) !== 200 ||
        !Buffer.isBuffer(asset.body)
    ) {
        return false;
    }

    const range = parseCachedHlsByteRange(
        req.headers.range,
        asset.body.length
    );
    if (!range) {
        return false;
    }

    copyBufferedAssetHeaders(res, asset);
    const body = asset.body.subarray(range.start, range.end + 1);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader(
        'Content-Range',
        'bytes ' + range.start + '-' + range.end + '/' + asset.body.length
    );
    res.setHeader('Content-Length', body.length);
    res.status(206).send(body);
    return true;
}

async function fetchHlsResourceOnce(req, upstreamUrl, parentSignal) {`,
  'range-aware buffered asset sender insertion'
);

replaceExactlyOnce(
  `    const cacheKey = getHlsAssetCacheKey(upstreamUrl);
    const canUseAssetCache = !req.headers.range;`,
  `    const cacheKey = getHlsAssetCacheKey(upstreamUrl);
    const canStoreAssetCache = !req.headers.range;`,
  'asset-cache storage flag rename'
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
  `        const cachedAsset = cache.get(cacheKey);
        if (
            cachedAsset &&
            cachedAsset.kind === 'asset' &&
            cachedAsset.body &&
            sendBufferedAssetForRequest(req, res, cachedAsset)
        ) {
            console.log(
                '[' + connId + '] ' +
                (req.headers.range
                    ? 'hls asset cache range hit "'
                    : 'hls asset cache hit "') +
                upstreamLabel + '"'
            );
            return;
        }`,
  'range-aware asset-cache lookup'
);

replaceExactlyOnce(
  `        if (canUseAssetCache) {
            cacheHlsAsset(cacheKey, result);
        }`,
  `        if (canStoreAssetCache) {
            cacheHlsAsset(cacheKey, result);
        }`,
  'asset-cache storage flag use'
);

replaceExactlyOnce(
  `const logicalPlaylistProgress = new Map();
const logicalMediaHealth = new Map();`,
  `const logicalPlaylistProgress = new Map();
const logicalPlaylistShape = new Map();
const logicalMediaHealth = new Map();`,
  'logical playlist shape state insertion'
);

replaceExactlyOnce(
  `function getLogicalPlaylistProgressKey(group, variant) {
    return group.id + '|' + variant.id;
}

function isLogicalPlaylistStalled(group, variant, upstream) {`,
  `function getLogicalPlaylistProgressKey(group, variant) {
    return group.id + '|' + variant.id;
}

function isLogicalPlaylistCollapsed(group, variant, upstream) {
    if (!upstream || upstream.stale) {
        return false;
    }

    const segments = getMediaPlaylistSegments(
        upstream.streamUrl,
        upstream.playlist
    );
    if (!segments.length) {
        return false;
    }

    const key = getLogicalPlaylistProgressKey(group, variant);
    const current = {
        count: segments.length,
        firstSequence: segments[0].sequence,
        lastSequence: segments[segments.length - 1].sequence
    };
    const previous = logicalPlaylistShape.get(key);
    logicalPlaylistShape.set(key, current);

    const collapsed = Boolean(
        previous &&
        previous.count >= 3 &&
        current.count <= 1 &&
        Number.isFinite(previous.lastSequence) &&
        Number.isFinite(current.lastSequence) &&
        current.lastSequence < previous.lastSequence
    );

    if (collapsed) {
        console.log(
            '[vavoo] logical playlist collapsed "' + group.name +
            '" variant="' + variant.name +
            '" previous_entries=' + previous.count +
            ' previous_last_sequence=' + previous.lastSequence +
            ' current_entries=' + current.count +
            ' current_last_sequence=' + current.lastSequence
        );
    }

    return collapsed;
}

function isLogicalPlaylistStalled(group, variant, upstream) {`,
  'collapsed live-playlist detector insertion'
);

replaceExactlyOnce(
  `    const tail = segments[segments.length - 1];
    const identity = tail.sequence + '|' + tail.url;`,
  `    const tail = segments[segments.length - 1];
    // EN: Media sequence is the progression signal. Signed/rotating segment
    // URLs must not make a frozen sequence look healthy.
    // FR : La séquence média est le signal de progression. Des URL signées
    // renouvelées ne doivent pas faire paraître une séquence figée comme saine.
    const identity = String(tail.sequence);`,
  'sequence-only playlist progression identity'
);

replaceExactlyOnce(
  `            if (isLogicalPlaylistStalled(group, variant, upstream)) {`,
  `            if (isLogicalPlaylistCollapsed(group, variant, upstream)) {
                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                markLogicalVariantFailure(
                    group,
                    variant,
                    'live playlist collapsed and reset'
                );
                continue;
            }

            if (isLogicalPlaylistStalled(group, variant, upstream)) {`,
  'collapsed playlist failover hook'
);

if (
  !source.includes('hls asset cache range hit') ||
  !source.includes('logical playlist collapsed') ||
  !source.includes('live playlist collapsed and reset') ||
  source.includes("const identity = tail.sequence + '|' + tail.url;") ||
  source.includes('const canUseAssetCache = !req.headers.range;')
) {
  throw new Error('runtime playback edge-case verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched range-aware HLS cache and degenerate live-playlist failover: ' + target
);
