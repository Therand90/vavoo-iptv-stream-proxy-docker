import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node stabilize-logical-active-stale-recovery.mjs <index.js>');
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

const helpers = String.raw`
function inspectLogicalStaleRecoveryBudget(group, variant, upstream) {
    const configuredGraceMs =
        LOGICAL_ACTIVE_STALE_GRACE_SECONDS * 1000;
    const fallback = {
        graceMs: configuredGraceMs,
        reserveSegments: 0,
        segmentDurationMs: 0,
        draining: false
    };

    if (!upstream || !upstream.playlist) {
        return fallback;
    }

    const drainState = logicalLiveEdgeDrainState.get(group.id);
    const draining = Boolean(
        drainState &&
        drainState.variantId === variant.id &&
        drainState.draining
    );

    if (draining || HLS_LIVE_EDGE_DELAY_SEGMENTS < 1) {
        return { ...fallback, draining };
    }

    let targetDurationSeconds = null;
    const durations = [];
    let segmentCount = 0;

    for (const rawLine of String(upstream.playlist).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            const parsed = Number.parseFloat(
                line.slice('#EXT-X-TARGETDURATION:'.length)
            );
            if (Number.isFinite(parsed) && parsed > 0) {
                targetDurationSeconds = parsed;
            }
            continue;
        }
        if (line.startsWith('#EXTINF:')) {
            const parsed = Number.parseFloat(
                line.slice('#EXTINF:'.length).split(',', 1)[0]
            );
            if (Number.isFinite(parsed) && parsed > 0) {
                durations.push(parsed);
            }
            continue;
        }
        if (line && !line.startsWith('#')) {
            segmentCount += 1;
        }
    }

    if (!segmentCount) {
        return fallback;
    }

    let segmentDurationSeconds = targetDurationSeconds;
    if (durations.length) {
        const average =
            durations.reduce((sum, value) => sum + value, 0) /
            durations.length;
        if (Number.isFinite(average) && average > 0) {
            segmentDurationSeconds = average;
        }
    }

    if (!Number.isFinite(segmentDurationSeconds) || segmentDurationSeconds <= 0) {
        return fallback;
    }

    const reserveSegments = Math.min(
        HLS_LIVE_EDGE_DELAY_SEGMENTS,
        segmentCount
    );
    if (reserveSegments < 1) {
        return fallback;
    }

    const segmentDurationMs = Math.round(segmentDurationSeconds * 1000);
    const reserveRunwayMs = segmentDurationMs * reserveSegments;
    const handoffReserveMs = Math.max(
        4000,
        PLAYLIST_FAST_FALLBACK_MS + 1000
    );
    const usableRunwayMs = Math.max(
        configuredGraceMs,
        reserveRunwayMs - handoffReserveMs
    );
    const graceMs = Math.min(45000, usableRunwayMs);

    return {
        graceMs,
        reserveSegments,
        segmentDurationMs,
        draining: false
    };
}
`;

replaceExactlyOnce(
  '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  '\n' + helpers + '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  'active stale recovery helper insertion'
);

replaceExactlyOnce(
  `                    const graceMs =
                        LOGICAL_ACTIVE_STALE_GRACE_SECONDS * 1000;

                    if (staleAgeMs < graceMs) {
                        console.log(
                            '[vavoo] logical active stale grace "' +
                            group.name + '" variant="' + variant.name +
                            '" age_ms=' + staleAgeMs +
                            ' grace_ms=' + graceMs
                        );
                        return { ...upstream, variant };
                    }`,
  `                    const staleRecovery =
                        inspectLogicalStaleRecoveryBudget(
                            group,
                            variant,
                            upstream
                        );
                    const graceMs = staleRecovery.graceMs;

                    if (staleAgeMs < graceMs) {
                        console.log(
                            '[vavoo] logical active stale grace "' +
                            group.name + '" variant="' + variant.name +
                            '" age_ms=' + staleAgeMs +
                            ' grace_ms=' + graceMs +
                            ' reserve_segments=' +
                            staleRecovery.reserveSegments +
                            ' segment_ms=' +
                            staleRecovery.segmentDurationMs +
                            ' draining=' + staleRecovery.draining
                        );
                        return { ...upstream, variant };
                    }`,
  'buffer-aware active stale grace'
);

if (
  !source.includes('inspectLogicalStaleRecoveryBudget') ||
  !source.includes('reserve_segments=') ||
  !source.includes('handoffReserveMs')
) {
  throw new Error('active stale recovery verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched buffer-aware active stale recovery grace: ' + target
);
