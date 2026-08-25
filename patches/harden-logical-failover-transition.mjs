import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-logical-failover-transition.mjs <index.js>');
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

// EN: When both variants have unknown audio metadata, do not let video score
// alone override VAVOO's source order. A higher-resolution stream with unknown
// audio can sound worse than a lower-resolution source whose audio is healthy.
// FR : Lorsque les deux variantes ont un audio inconnu, le score vidéo seul ne
// doit pas écraser l'ordre des sources VAVOO. Un flux plus défini peut avoir un
// son nettement moins bon qu'une source vidéo plus modeste.
replaceExactly(
  `        if (LOGICAL_QUALITY_RANKING_ENABLED) {
            const scoreDifference = right.quality.score - left.quality.score;
            if (scoreDifference) {
                return scoreDifference;
            }
        }
        return left.index - right.index;`,
  `        if (LOGICAL_QUALITY_RANKING_ENABLED) {
            const leftAudioClass = String(
                left.quality && left.quality.audioLanguageClass || 'unknown'
            );
            const rightAudioClass = String(
                right.quality && right.quality.audioLanguageClass || 'unknown'
            );
            const bothAudioUnknown =
                ['unknown', 'disabled'].includes(leftAudioClass) &&
                ['unknown', 'disabled'].includes(rightAudioClass);

            if (!bothAudioUnknown) {
                const scoreDifference =
                    right.quality.score - left.quality.score;
                if (scoreDifference) {
                    return scoreDifference;
                }
            }
        }
        return left.index - right.index;`,
  2,
  'unknown-audio source-order ranking guard'
);

const failoverTransitionHelpers = String.raw`
const logicalLiveEdgeDrainState = new Map();

function getLogicalLiveEdgeDelaySegments(group, variant, upstream) {
    if (!upstream || upstream.stale || HLS_LIVE_EDGE_DELAY_SEGMENTS < 1) {
        return 0;
    }

    let state = logicalLiveEdgeDrainState.get(group.id);
    if (!state || state.variantId !== variant.id) {
        state = {
            variantId: variant.id,
            draining: false
        };
        logicalLiveEdgeDrainState.set(group.id, state);
    }

    if (state.draining) {
        return 0;
    }

    const progress = logicalPlaylistProgress.get(
        getLogicalPlaylistProgressKey(group, variant)
    );
    if (!progress || LOGICAL_PLAYLIST_STALL_SECONDS <= 0) {
        return HLS_LIVE_EDGE_DELAY_SEGMENTS;
    }

    const ageMs = Date.now() - progress.firstSeenAt;
    const stallMs = LOGICAL_PLAYLIST_STALL_SECONDS * 1000;
    const drainAtMs = Math.max(1000, Math.floor(stallMs * 0.60));

    if (ageMs < drainAtMs) {
        return HLS_LIVE_EDGE_DELAY_SEGMENTS;
    }

    state.draining = true;
    console.log(
        '[vavoo] logical live-edge buffer drain "' + group.name +
        '" variant="' + variant.name +
        '" age_ms=' + ageMs +
        ' drain_at_ms=' + drainAtMs +
        ' released_segments=' + HLS_LIVE_EDGE_DELAY_SEGMENTS
    );
    return 0;
}

async function fetchLogicalFastFailoverPlaylist(req, variant) {
    const playlistCacheKey = getPlaylistCacheKey(variant);
    const stalePlaylist = cache.get(playlistCacheKey);

    // EN/FR: If this source has already played, the normal helper already owns
    // a bounded fast stale-playlist path. Reuse it rather than duplicating it.
    if (stalePlaylist) {
        return fetchChannelPlaylist(req, variant);
    }

    // EN: A cold failover candidate must not enter the legacy 30-second retry
    // path. Resolve a fresh URL once and use the existing fast HLS deadline.
    // FR : Un candidat de secours froid ne doit pas entrer dans les retries de
    // 30 s. On résout une URL fraîche une fois puis on applique le budget HLS
    // rapide existant.
    cache.del(getStreamUrlCacheKey(variant));
    const streamUrl = await getCachedStreamUrl(variant, true);

    console.log(
        '[vavoo] logical fast failover probe variant="' + variant.name +
        '" budget_ms=' + PLAYLIST_FAST_FALLBACK_MS
    );

    const result = await fetchPlaylistHedgedOnce(
        req,
        variant,
        streamUrl
    );
    cache.set(
        playlistCacheKey,
        result,
        PLAYLIST_CACHE_TTL_SECONDS
    );
    return { ...result, stale: false };
}
`;

replaceExactlyOnce(
  '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  '\n' + failoverTransitionHelpers +
    '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  'logical transition helpers insertion'
);

replaceExactlyOnce(
  `        if (attemptedVariantIds.size > 0) {
            console.log(
                '[vavoo] logical candidate reranking "' + group.name +
                '" attempted=' + attemptedVariantIds.size +
                ' next="' + variant.name + '"'
            );
        }
        attemptedVariantIds.add(variant.id);`,
  `        const isFailoverCandidate = attemptedVariantIds.size > 0;
        if (isFailoverCandidate) {
            console.log(
                '[vavoo] logical candidate reranking "' + group.name +
                '" attempted=' + attemptedVariantIds.size +
                ' next="' + variant.name + '"'
            );
        }
        attemptedVariantIds.add(variant.id);`,
  'logical failover candidate flag'
);

replaceExactlyOnce(
  '            let upstream = await fetchChannelPlaylist(req, variant);',
  `            let upstream = isFailoverCandidate
                ? await fetchLogicalFastFailoverPlaylist(req, variant)
                : await fetchChannelPlaylist(req, variant);`,
  'fast cold logical failover fetch'
);

replaceExactlyOnce(
  `        const liveEdge = applyHlsLiveEdgeSafetyDelay(
            upstream.playlist,
            upstream.stale ? 0 : HLS_LIVE_EDGE_DELAY_SEGMENTS
        );
        const logicalPlaylist = rewriteLogicalPlaylistTimeline(`,
  `        const logicalLiveEdgeDelay = getLogicalLiveEdgeDelaySegments(
            group,
            upstream.variant,
            upstream
        );
        const liveEdge = applyHlsLiveEdgeSafetyDelay(
            upstream.playlist,
            logicalLiveEdgeDelay
        );
        const logicalPlaylist = rewriteLogicalPlaylistTimeline(`,
  'logical live-edge drain-aware delay'
);

if (
  !source.includes('logical live-edge buffer drain') ||
  !source.includes('logical fast failover probe') ||
  !source.includes('bothAudioUnknown') ||
  !source.includes('fetchLogicalFastFailoverPlaylist')
) {
  throw new Error('logical failover transition verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical live-edge drain, fast failover candidates and unknown-audio ordering: ' +
  target
);
