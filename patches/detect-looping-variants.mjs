import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node detect-looping-variants.mjs <index.js>');
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
  'const logicalVariantState = new Map();',
  `const logicalVariantState = new Map();
const logicalLoopState = new Map();
const logicalTimelineState = new Map();

const LOGICAL_LOOP_DETECTION_ENABLED =
    String(process.env.VAVOO_LOOP_DETECTION_ENABLED || 'true')
        .toLowerCase() !== 'false';

const LOGICAL_LOOP_SIMILARITY_THRESHOLD = (() => {
    const configured = Number.parseFloat(
        process.env.VAVOO_LOOP_SIMILARITY_THRESHOLD || '0.70'
    );
    return Number.isFinite(configured) && configured >= 0.50 && configured <= 1
        ? configured
        : 0.70;
})();

const LOGICAL_LOOP_MIN_COMMON_NALS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOOP_MIN_COMMON_NALS || '100',
        10
    );
    return Number.isFinite(configured) && configured >= 20
        ? Math.min(configured, 10000)
        : 100;
})();

const LOGICAL_LOOP_CONFIRMATIONS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOOP_CONFIRMATIONS || '2',
        10
    );
    return Number.isFinite(configured) && configured >= 2
        ? Math.min(configured, 6)
        : 2;
})();

const LOGICAL_LOOP_HISTORY_SEGMENTS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOOP_HISTORY_SEGMENTS || '8',
        10
    );
    return Number.isFinite(configured) && configured >= 6
        ? Math.min(configured, 20)
        : 8;
})();

const LOGICAL_LOOP_QUARANTINE_SECONDS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOOP_QUARANTINE_SECONDS || '1800',
        10
    );
    return Number.isFinite(configured) && configured >= 300
        ? Math.min(configured, 86400)
        : 1800;
})();`,
  'logical loop constants insertion'
);

replaceExactlyOnce(
  `function markLogicalVariantFailure(group, variant, reason) {
    const state = getLogicalVariantState(group);
    const until = Date.now() + LOGICAL_VARIANT_QUARANTINE_SECONDS * 1000;
    state.quarantinedUntil.set(variant.id, until);

    if (state.activeVariantId === variant.id) {
        state.activeVariantId = null;
    }

    console.log(
        '[vavoo] logical variant quarantined "' + group.name +
        '" variant="' + variant.name +
        '" ttl=' + LOGICAL_VARIANT_QUARANTINE_SECONDS +
        's reason="' + reason + '"'
    );
}`,
  `function markLogicalVariantFailure(
    group,
    variant,
    reason,
    ttlSeconds = LOGICAL_VARIANT_QUARANTINE_SECONDS
) {
    const state = getLogicalVariantState(group);
    const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds >= 30
        ? Math.min(Math.floor(ttlSeconds), 86400)
        : LOGICAL_VARIANT_QUARANTINE_SECONDS;
    const until = Date.now() + safeTtl * 1000;
    state.quarantinedUntil.set(variant.id, until);

    if (state.activeVariantId === variant.id) {
        state.activeVariantId = null;
    }

    console.log(
        '[vavoo] logical variant quarantined "' + group.name +
        '" variant="' + variant.name +
        '" ttl=' + safeTtl +
        's reason="' + reason + '"'
    );
}`,
  'logical variant quarantine TTL extension'
);

const detectorHelpers = `
function getLogicalLoopKey(group, variant) {
    return group.id + '|' + variant.id;
}

function getLogicalLoopRuntime(group, variant) {
    const key = getLogicalLoopKey(group, variant);
    let state = logicalLoopState.get(key);

    if (!state) {
        state = {
            history: [],
            pending: new Set(),
            consecutiveMatches: 0
        };
        logicalLoopState.set(key, state);
    }

    return state;
}

function resetLogicalLoopRuntime(group, variant) {
    logicalLoopState.delete(getLogicalLoopKey(group, variant));
}

function getMediaPlaylistSegments(streamUrl, playlist) {
    const lines = String(playlist || '').split(/\\r?\\n/);
    let mediaSequence = null;
    const segments = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            const parsed = Number.parseInt(line.split(':', 2)[1], 10);
            if (Number.isFinite(parsed)) {
                mediaSequence = parsed;
            }
            continue;
        }

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
            segments.push(parsed.toString());
        } catch (error) {
            // Ignore malformed segment URLs. The playlist itself is still served.
        }
    }

    if (!Number.isFinite(mediaSequence)) {
        return [];
    }

    return segments.map((url, index) => ({
        sequence: mediaSequence + index,
        url
    }));
}

function findMpegTsStart(buffer) {
    const limit = Math.min(188, buffer.length);

    for (let offset = 0; offset < limit; offset += 1) {
        if (
            offset + 188 * 2 < buffer.length &&
            buffer[offset] === 0x47 &&
            buffer[offset + 188] === 0x47 &&
            buffer[offset + 376] === 0x47
        ) {
            return offset;
        }
    }

    return -1;
}

function extractPesPayloads(buffer) {
    const start = findMpegTsStart(buffer);
    if (start < 0) {
        return new Map();
    }

    const output = new Map();
    const pesPids = new Set();

    for (let position = start; position + 187 < buffer.length; position += 188) {
        const packet = buffer.subarray(position, position + 188);
        if (packet[0] !== 0x47) {
            continue;
        }

        const payloadUnitStart = Boolean(packet[1] & 0x40);
        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid === 0x1fff) {
            continue;
        }

        const adaptationFieldControl = (packet[3] >> 4) & 0x03;
        if (![1, 3].includes(adaptationFieldControl)) {
            continue;
        }

        let offset = 4;
        if (adaptationFieldControl === 3) {
            if (offset >= 188) {
                continue;
            }
            offset += 1 + packet[offset];
        }

        if (offset >= 188) {
            continue;
        }

        let payload = packet.subarray(offset);

        if (payloadUnitStart) {
            if (
                payload.length < 9 ||
                payload[0] !== 0x00 ||
                payload[1] !== 0x00 ||
                payload[2] !== 0x01
            ) {
                continue;
            }

            pesPids.add(pid);
            const headerLength = 9 + payload[8];
            if (headerLength >= payload.length) {
                continue;
            }
            payload = payload.subarray(headerLength);
        } else if (!pesPids.has(pid)) {
            continue;
        }

        if (!payload.length) {
            continue;
        }

        let chunks = output.get(pid);
        if (!chunks) {
            chunks = [];
            output.set(pid, chunks);
        }
        chunks.push(payload);
    }

    const joined = new Map();
    for (const [pid, chunks] of output.entries()) {
        joined.set(pid, Buffer.concat(chunks));
    }
    return joined;
}

function findAnnexBStarts(payload) {
    const starts = [];

    for (let index = 0; index + 3 < payload.length; index += 1) {
        if (
            payload[index] === 0x00 &&
            payload[index + 1] === 0x00 &&
            payload[index + 2] === 0x01
        ) {
            starts.push({ index, size: 3 });
            index += 2;
            continue;
        }

        if (
            index + 4 < payload.length &&
            payload[index] === 0x00 &&
            payload[index + 1] === 0x00 &&
            payload[index + 2] === 0x00 &&
            payload[index + 3] === 0x01
        ) {
            starts.push({ index, size: 4 });
            index += 3;
        }
    }

    return starts;
}

function getLargeNalHashes(payload) {
    const starts = findAnnexBStarts(payload);
    if (starts.length < 3) {
        return [];
    }

    const hashes = [];

    for (let index = 1; index < starts.length - 1; index += 1) {
        const current = starts[index];
        const next = starts[index + 1];
        const begin = current.index + current.size;
        const end = next.index;

        if (end - begin < 500) {
            continue;
        }

        hashes.push(
            crypto
                .createHash('sha256')
                .update(payload.subarray(begin, end))
                .digest('hex')
                .slice(0, 24)
        );
    }

    return hashes;
}

function fingerprintTransportStream(buffer) {
    const payloads = extractPesPayloads(buffer);
    let selected = null;

    for (const [pid, payload] of payloads.entries()) {
        const hashes = getLargeNalHashes(payload);
        if (!hashes.length) {
            continue;
        }

        const candidate = {
            pid,
            hashes: new Set(hashes),
            count: hashes.length
        };

        if (!selected || candidate.count > selected.count) {
            selected = candidate;
        }
    }

    return selected;
}

function compareLogicalFingerprints(left, right) {
    if (!left || !right || !left.hashes.size || !right.hashes.size) {
        return { similarity: 0, common: 0 };
    }

    const small = left.hashes.size <= right.hashes.size
        ? left.hashes
        : right.hashes;
    const large = small === left.hashes ? right.hashes : left.hashes;
    let common = 0;

    for (const hash of small) {
        if (large.has(hash)) {
            common += 1;
        }
    }

    return {
        common,
        similarity: small.size ? common / small.size : 0
    };
}

async function fetchLogicalLoopAsset(req, segmentUrl) {
    const cacheKey = getHlsAssetCacheKey(segmentUrl);
    const cached = cache.get(cacheKey);

    if (cached && cached.kind === 'asset') {
        return cached;
    }

    const upstreamLabel = describeHlsAssetUrl(segmentUrl);
    const parentSignal = AbortSignal.timeout(20000);
    const started = startSharedHlsAssetFetch(
        req,
        segmentUrl,
        parentSignal,
        upstreamLabel
    );
    return started.promise;
}

async function observeLogicalVariantSegments(
    req,
    group,
    variant,
    streamUrl,
    playlist
) {
    if (!LOGICAL_LOOP_DETECTION_ENABLED || group.variants.length < 2) {
        return;
    }

    const state = getLogicalLoopRuntime(group, variant);
    const segments = getMediaPlaylistSegments(streamUrl, playlist).slice(-2);

    for (const segment of segments) {
        const key = segment.sequence + '|' + segment.url;

        if (
            state.pending.has(key) ||
            state.history.some((entry) => entry.key === key)
        ) {
            continue;
        }

        state.pending.add(key);

        try {
            const asset = await fetchLogicalLoopAsset(req, segment.url);
            if (!asset || asset.kind !== 'asset' || !asset.body) {
                continue;
            }

            const fingerprint = fingerprintTransportStream(asset.body);
            if (
                !fingerprint ||
                fingerprint.hashes.size < LOGICAL_LOOP_MIN_COMMON_NALS
            ) {
                state.consecutiveMatches = 0;
                continue;
            }

            let best = { similarity: 0, common: 0, sequence: null };

            for (const previous of state.history) {
                if (previous.sequence === segment.sequence) {
                    continue;
                }

                const compared = compareLogicalFingerprints(
                    fingerprint,
                    previous.fingerprint
                );

                if (
                    compared.similarity > best.similarity ||
                    (
                        compared.similarity === best.similarity &&
                        compared.common > best.common
                    )
                ) {
                    best = {
                        ...compared,
                        sequence: previous.sequence
                    };
                }
            }

            const suspicious =
                best.similarity >= LOGICAL_LOOP_SIMILARITY_THRESHOLD &&
                best.common >= LOGICAL_LOOP_MIN_COMMON_NALS;

            state.consecutiveMatches = suspicious
                ? state.consecutiveMatches + 1
                : 0;

            state.history.push({
                key,
                sequence: segment.sequence,
                fingerprint
            });

            while (state.history.length > LOGICAL_LOOP_HISTORY_SEGMENTS) {
                state.history.shift();
            }

            if (suspicious) {
                console.log(
                    '[vavoo] logical loop candidate "' + group.name +
                    '" variant="' + variant.name +
                    '" sequence=' + segment.sequence +
                    ' matches=' + best.sequence +
                    ' similarity=' + best.similarity.toFixed(3) +
                    ' common_nals=' + best.common +
                    ' confirmations=' + state.consecutiveMatches +
                    '/' + LOGICAL_LOOP_CONFIRMATIONS
                );
            }

            if (state.consecutiveMatches >= LOGICAL_LOOP_CONFIRMATIONS) {
                const reason =
                    'repeating video payload similarity=' +
                    best.similarity.toFixed(3) +
                    ' common_nals=' + best.common;

                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                markLogicalVariantFailure(
                    group,
                    variant,
                    reason,
                    LOGICAL_LOOP_QUARANTINE_SECONDS
                );
                resetLogicalLoopRuntime(group, variant);

                console.log(
                    '[vavoo] logical loop confirmed "' + group.name +
                    '" variant="' + variant.name +
                    '" -> failover on next playlist refresh'
                );
                return;
            }
        } catch (error) {
            console.log(
                '[vavoo] logical loop probe skipped "' + group.name +
                '" variant="' + variant.name +
                '" error="' + String(
                    error && error.message ? error.message : error
                ) + '"'
            );
        } finally {
            state.pending.delete(key);
        }
    }
}

function getLogicalTimelineRuntime(group) {
    let state = logicalTimelineState.get(group.id);

    if (!state) {
        state = {
            variantId: null,
            offset: 0,
            lastLogicalEnd: null,
            switchSequence: null
        };
        logicalTimelineState.set(group.id, state);
    }

    return state;
}

function rewriteLogicalPlaylistTimeline(group, variant, playlist) {
    const lines = String(playlist || '').split(/\\r?\\n/);
    let sourceFirst = null;
    let segmentCount = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            const parsed = Number.parseInt(line.split(':', 2)[1], 10);
            if (Number.isFinite(parsed)) {
                sourceFirst = parsed;
            }
        } else if (line && !line.startsWith('#')) {
            segmentCount += 1;
        }
    }

    if (!Number.isFinite(sourceFirst) || segmentCount < 1) {
        return playlist;
    }

    const state = getLogicalTimelineRuntime(group);
    let logicalFirst = sourceFirst + state.offset;
    let switched = false;

    if (state.variantId === null) {
        state.variantId = variant.id;
    } else if (state.variantId !== variant.id) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.variantId = variant.id;
        state.switchSequence = logicalFirst;
        switched = true;
    } else if (
        Number.isFinite(state.lastLogicalEnd) &&
        logicalFirst + segmentCount - 1 <= state.lastLogicalEnd
    ) {
        logicalFirst = state.lastLogicalEnd + 1;
        state.offset = logicalFirst - sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    }

    const logicalEnd = logicalFirst + segmentCount - 1;
    state.lastLogicalEnd = Number.isFinite(state.lastLogicalEnd)
        ? Math.max(state.lastLogicalEnd, logicalEnd)
        : logicalEnd;

    if (switched) {
        console.log(
            '[vavoo] logical timeline discontinuity "' + group.name +
            '" variant="' + variant.name +
            '" media_sequence=' + logicalFirst
        );
    }

    const targetDiscontinuity =
        Number.isFinite(state.switchSequence) &&
        state.switchSequence >= logicalFirst &&
        state.switchSequence <= logicalEnd
            ? state.switchSequence - logicalFirst
            : null;

    const output = [];
    let segmentIndex = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            output.push('#EXT-X-MEDIA-SEQUENCE:' + logicalFirst);
            continue;
        }

        if (
            line.startsWith('#EXTINF:') &&
            targetDiscontinuity === segmentIndex &&
            output[output.length - 1] !== '#EXT-X-DISCONTINUITY'
        ) {
            output.push('#EXT-X-DISCONTINUITY');
        }

        output.push(rawLine);

        if (line && !line.startsWith('#')) {
            segmentIndex += 1;
        }
    }

    return output.join('\\n');
}
`;

replaceExactlyOnce(
  '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  '\n' + detectorHelpers + '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  'logical loop detector helpers insertion'
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
            upstream.variant.name
        );`,
  `        const logicalPlaylist = rewriteLogicalPlaylistTimeline(
            group,
            upstream.variant,
            upstream.playlist
        );
        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            logicalPlaylist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            upstream.variant.name
        );
        void observeLogicalVariantSegments(
            req,
            group,
            upstream.variant,
            upstream.streamUrl,
            upstream.playlist
        );`,
  'logical playlist timeline and loop observer insertion'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical VAVOO loop detection and timeline continuity: ' +
  target
);
