import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-logical-failover-continuity.mjs <index.js>');
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
  'const logicalTimelineState = new Map();',
  `const logicalTimelineState = new Map();
const logicalVariantFailureGeneration = new Map();
const logicalPlaylistWindowHealth = new Map();`,
  'logical failover runtime maps insertion'
);

replaceExactlyOnce(
  `        state = {
            variantId: null,
            offset: 0,
            lastLogicalEnd: null,
            lastSourceFirst: null,
            switchSequence: null
        };`,
  `        state = {
            variantId: null,
            offset: 0,
            lastLogicalEnd: null,
            lastSourceFirst: null,
            switchSequence: null,
            discontinuitySequence: 0,
            discontinuities: []
        };`,
  'logical discontinuity runtime state extension'
);

const currentTimelineFunction = String.raw`function rewriteLogicalPlaylistTimeline(group, variant, playlist) {
    const lines = String(playlist || '').split(/\r?\n/);
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
        state.lastSourceFirst = sourceFirst;
    } else if (state.variantId !== variant.id) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.variantId = variant.id;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else if (
        Number.isFinite(state.lastSourceFirst) &&
        sourceFirst < state.lastSourceFirst
    ) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else {
        state.lastSourceFirst = sourceFirst;
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

    return output.join('\n');
}`;

const hardenedTimelineFunction = String.raw`function rewriteLogicalPlaylistTimeline(group, variant, playlist) {
    const lines = String(playlist || '').split(/\r?\n/);
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
        state.lastSourceFirst = sourceFirst;
    } else if (state.variantId !== variant.id) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.variantId = variant.id;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else if (
        Number.isFinite(state.lastSourceFirst) &&
        sourceFirst < state.lastSourceFirst
    ) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else {
        state.lastSourceFirst = sourceFirst;
    }

    const logicalEnd = logicalFirst + segmentCount - 1;
    state.lastLogicalEnd = Number.isFinite(state.lastLogicalEnd)
        ? Math.max(state.lastLogicalEnd, logicalEnd)
        : logicalEnd;

    if (switched) {
        state.discontinuities.push(logicalFirst);
        console.log(
            '[vavoo] logical timeline discontinuity "' + group.name +
            '" variant="' + variant.name +
            '" media_sequence=' + logicalFirst
        );
    }

    // EN: Keep the discontinuity count after its marker leaves the sliding
    // live window. Kodi can then relate the next media sequence to the same
    // logical timeline instead of treating the timestamp jump as unexplained.
    // FR : Conserve le nombre de discontinuités après la sortie du marqueur de
    // la fenêtre live, afin que Kodi rattache les timestamps au bon historique.
    while (
        state.discontinuities.length &&
        state.discontinuities[0] < logicalFirst
    ) {
        state.discontinuities.shift();
        state.discontinuitySequence += 1;
    }

    const targetDiscontinuities = new Set(
        state.discontinuities
            .filter((sequence) =>
                sequence >= logicalFirst && sequence <= logicalEnd
            )
            .map((sequence) => sequence - logicalFirst)
    );
    const shouldWriteDiscontinuitySequence =
        state.discontinuitySequence > 0 || state.discontinuities.length > 0;

    const output = [];
    let segmentIndex = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // EN/FR: The logical timeline owns this tag. Ignore any duplicate
        // source line and emit exactly one coherent value next to MEDIA-SEQUENCE.
        if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
            continue;
        }

        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            output.push('#EXT-X-MEDIA-SEQUENCE:' + logicalFirst);
            if (shouldWriteDiscontinuitySequence) {
                output.push(
                    '#EXT-X-DISCONTINUITY-SEQUENCE:' +
                    state.discontinuitySequence
                );
            }
            continue;
        }

        if (
            line.startsWith('#EXTINF:') &&
            targetDiscontinuities.has(segmentIndex) &&
            output[output.length - 1] !== '#EXT-X-DISCONTINUITY'
        ) {
            output.push('#EXT-X-DISCONTINUITY');
        }

        output.push(rawLine);

        if (line && !line.startsWith('#')) {
            segmentIndex += 1;
        }
    }

    return output.join('\n');
}`;

replaceExactlyOnce(
  currentTimelineFunction,
  hardenedTimelineFunction,
  'persistent logical discontinuity sequence rewrite'
);

replaceExactlyOnce(
  String.raw`function markLogicalVariantFailure(
    group,
    variant,
    reason,
    ttlSeconds = LOGICAL_VARIANT_QUARANTINE_SECONDS
) {
    const state = getLogicalVariantState(group);`,
  String.raw`function markLogicalVariantFailure(
    group,
    variant,
    reason,
    ttlSeconds = LOGICAL_VARIANT_QUARANTINE_SECONDS
) {
    const state = getLogicalVariantState(group);
    bumpLogicalVariantFailureGeneration(group, variant);`,
  'logical variant failure generation bump'
);

const failoverContinuityHelpers = String.raw`
function getLogicalVariantFailureGenerationKey(group, variant) {
    return group.id + '|' + variant.id;
}

function getLogicalVariantFailureGeneration(group, variant) {
    return logicalVariantFailureGeneration.get(
        getLogicalVariantFailureGenerationKey(group, variant)
    ) || 0;
}

function bumpLogicalVariantFailureGeneration(group, variant) {
    const key = getLogicalVariantFailureGenerationKey(group, variant);
    const next = (logicalVariantFailureGeneration.get(key) || 0) + 1;
    logicalVariantFailureGeneration.set(key, next);
    return next;
}

function isLogicalVariantAttemptCurrent(
    group,
    variant,
    generation,
    phase
) {
    const current = getLogicalVariantFailureGeneration(group, variant);
    if (current === generation) {
        return true;
    }

    console.log(
        '[vavoo] logical stale in-flight result ignored "' + group.name +
        '" variant="' + variant.name +
        '" phase=' + phase +
        ' started_generation=' + generation +
        ' current_generation=' + current
    );
    return false;
}

function getLogicalPlaylistWindowHealthKey(group, variant) {
    return group.id + '|' + variant.id;
}

function inspectLogicalPlaylistWindow(group, variant, upstream) {
    if (!upstream || upstream.stale) {
        return {
            segmentCount: 0,
            previousHealthySegments: 0,
            collapsed: false
        };
    }

    const segmentCount = getMediaPlaylistSegments(
        upstream.streamUrl,
        upstream.playlist
    ).length;
    const key = getLogicalPlaylistWindowHealthKey(group, variant);
    let state = logicalPlaylistWindowHealth.get(key);

    if (!state) {
        state = { maxHealthySegments: 0 };
        logicalPlaylistWindowHealth.set(key, state);
    }

    const previousHealthySegments = state.maxHealthySegments;

    if (segmentCount >= 3) {
        state.maxHealthySegments = Math.max(
            state.maxHealthySegments,
            segmentCount
        );
        return {
            segmentCount,
            previousHealthySegments,
            collapsed: false
        };
    }

    return {
        segmentCount,
        previousHealthySegments,
        collapsed:
            segmentCount >= 1 &&
            segmentCount <= 2 &&
            previousHealthySegments >= 3
    };
}
`;

replaceExactlyOnce(
  '\nfunction getLogicalVariantsFromCachedQuality(group) {',
  '\n' + failoverContinuityHelpers +
    '\nfunction getLogicalVariantsFromCachedQuality(group) {',
  'logical failover continuity helpers insertion'
);

replaceExactlyOnce(
  String.raw`        attemptedVariantIds.add(variant.id);
        try {
            const upstream = await fetchChannelPlaylist(req, variant);

            // EN: A logical group represents a live TV channel. ENDLIST means`,
  String.raw`        attemptedVariantIds.add(variant.id);
        const attemptGeneration = getLogicalVariantFailureGeneration(
            group,
            variant
        );

        try {
            let upstream = await fetchChannelPlaylist(req, variant);

            if (!isLogicalVariantAttemptCurrent(
                group,
                variant,
                attemptGeneration,
                'playlist-fetch'
            )) {
                continue;
            }

            // EN: A logical group represents a live TV channel. ENDLIST means`,
  'logical in-flight generation capture and first guard'
);

replaceExactlyOnce(
  String.raw`                markLogicalVariantFailure(
                    group,
                    variant,
                    'live playlist advertised EXT-X-ENDLIST'
                );
                continue;
            }

            if (upstream.stale) {`,
  String.raw`                markLogicalVariantFailure(
                    group,
                    variant,
                    'live playlist advertised EXT-X-ENDLIST'
                );
                continue;
            }

            let windowHealth = inspectLogicalPlaylistWindow(
                group,
                variant,
                upstream
            );

            if (windowHealth.collapsed) {
                console.log(
                    '[vavoo] logical playlist window collapse "' + group.name +
                    '" variant="' + variant.name +
                    '" entries=' + windowHealth.segmentCount +
                    ' previous_healthy=' + windowHealth.previousHealthySegments +
                    ' -> forced refresh'
                );

                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                logicalPlaylistProgress.delete(
                    getLogicalPlaylistProgressKey(group, variant)
                );
                logicalMediaHealth.delete(
                    getLogicalMediaHealthKey(group, variant)
                );

                upstream = await fetchChannelPlaylist(req, variant);

                if (!isLogicalVariantAttemptCurrent(
                    group,
                    variant,
                    attemptGeneration,
                    'forced-refresh'
                )) {
                    continue;
                }

                if (logicalLivePlaylistHasEndList(upstream.playlist)) {
                    const refreshDebugInfo = getPlaylistDebugInfo(
                        upstream.playlist
                    );
                    cache.del(getStreamUrlCacheKey(variant));
                    cache.del(getPlaylistCacheKey(variant));
                    logicalPlaylistProgress.delete(
                        getLogicalPlaylistProgressKey(group, variant)
                    );
                    logicalMediaHealth.delete(
                        getLogicalMediaHealthKey(group, variant)
                    );
                    lastError = new Error(
                        'live playlist advertised EXT-X-ENDLIST'
                    );
                    console.log(
                        '[vavoo] logical live playlist ended "' + group.name +
                        '" variant="' + variant.name +
                        '" sequence=' + refreshDebugInfo.sequence +
                        ' entries=' + refreshDebugInfo.segments
                    );
                    markLogicalVariantFailure(
                        group,
                        variant,
                        'live playlist advertised EXT-X-ENDLIST'
                    );
                    continue;
                }

                windowHealth = inspectLogicalPlaylistWindow(
                    group,
                    variant,
                    upstream
                );

                if (windowHealth.collapsed) {
                    const reason =
                        'live playlist window collapsed to ' +
                        windowHealth.segmentCount + ' segment(s)';
                    lastError = new Error(reason);
                    cache.del(getStreamUrlCacheKey(variant));
                    cache.del(getPlaylistCacheKey(variant));
                    logicalPlaylistProgress.delete(
                        getLogicalPlaylistProgressKey(group, variant)
                    );
                    logicalMediaHealth.delete(
                        getLogicalMediaHealthKey(group, variant)
                    );
                    console.log(
                        '[vavoo] logical playlist window collapse confirmed "' +
                        group.name + '" variant="' + variant.name +
                        '" entries=' + windowHealth.segmentCount +
                        ' previous_healthy=' +
                        windowHealth.previousHealthySegments +
                        ' -> failover'
                    );
                    markLogicalVariantFailure(
                        group,
                        variant,
                        reason
                    );
                    continue;
                }

                console.log(
                    '[vavoo] logical playlist window recovered "' + group.name +
                    '" variant="' + variant.name +
                    '" entries=' + windowHealth.segmentCount
                );
            }

            if (upstream.stale) {`,
  'logical collapsed-window forced refresh watchdog'
);

replaceExactlyOnce(
  String.raw`            if (!await isLogicalVariantMediaLive(
                req,
                group,
                variant,
                upstream
            )) {
                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                markLogicalVariantFailure(
                    group,
                    variant,
                    'playlist reachable but media segments unavailable'
                );
                continue;
            }

            markLogicalVariantSuccess(group, variant);`,
  String.raw`            if (!await isLogicalVariantMediaLive(
                req,
                group,
                variant,
                upstream
            )) {
                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                markLogicalVariantFailure(
                    group,
                    variant,
                    'playlist reachable but media segments unavailable'
                );
                continue;
            }

            if (!isLogicalVariantAttemptCurrent(
                group,
                variant,
                attemptGeneration,
                'media-probe'
            )) {
                continue;
            }

            markLogicalVariantSuccess(group, variant);`,
  'logical in-flight generation guard before success'
);

if (
  !source.includes('#EXT-X-DISCONTINUITY-SEQUENCE:') ||
  !source.includes('discontinuitySequence') ||
  !source.includes('logical stale in-flight result ignored') ||
  !source.includes('started_generation=') ||
  !source.includes('logical playlist window collapse') ||
  !source.includes('logical playlist window collapse confirmed') ||
  !source.includes('logical playlist window recovered') ||
  !source.includes("phase=' + phase")
) {
  throw new Error('logical failover continuity verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical HLS discontinuity persistence, in-flight race protection and collapsed-window failover: ' +
  target
);
