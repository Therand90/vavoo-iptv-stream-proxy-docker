import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-logical-source-selection.mjs <index.js>');
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
  `function getLogicalAudioLanguageRank(quality) {
    const classification = String(quality && quality.audioLanguageClass || 'unknown');
    if (classification === 'preferred') {
        return 3;
    }
    if (classification === 'other') {
        return 2;
    }
    if (classification === 'unknown' || classification === 'disabled') {
        return 1;
    }
    return 0;
}`,
  `function getLogicalAudioLanguageRank(quality) {
    const classification = String(quality && quality.audioLanguageClass || 'unknown');
    if (classification === 'preferred') {
        return 3;
    }
    // EN: Unknown metadata is safer than a language known to be foreign.
    // FR : Une langue inconnue est préférable à une langue étrangère confirmée.
    if (classification === 'unknown' || classification === 'disabled') {
        return 2;
    }
    if (classification === 'other') {
        return 1;
    }
    return 0;
}`,
  'logical audio-language fallback priority'
);

const playlistProgressHelpers = String.raw`
const LOGICAL_PLAYLIST_STALL_SECONDS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS || '20',
        10
    );
    return Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 300)
        : 20;
})();

const LOGICAL_MEDIA_PROBE_TIMEOUT_MS = 4500;
const LOGICAL_MEDIA_HEALTH_CACHE_MS = 30000;
const logicalPlaylistProgress = new Map();
const logicalMediaHealth = new Map();

function getLogicalPlaylistProgressKey(group, variant) {
    return group.id + '|' + variant.id;
}

function isLogicalPlaylistStalled(group, variant, upstream) {
    if (
        LOGICAL_PLAYLIST_STALL_SECONDS <= 0 ||
        !upstream ||
        upstream.stale
    ) {
        return false;
    }

    const segments = getMediaPlaylistSegments(
        upstream.streamUrl,
        upstream.playlist
    );
    if (!segments.length) {
        return false;
    }

    const tail = segments[segments.length - 1];
    const identity = tail.sequence + '|' + tail.url;
    const key = getLogicalPlaylistProgressKey(group, variant);
    const now = Date.now();
    const previous = logicalPlaylistProgress.get(key);

    if (!previous || previous.identity !== identity) {
        logicalPlaylistProgress.set(key, {
            identity,
            firstSeenAt: now,
            sequence: tail.sequence
        });
        return false;
    }

    const ageMs = now - previous.firstSeenAt;
    const stallMs = LOGICAL_PLAYLIST_STALL_SECONDS * 1000;
    if (ageMs < stallMs) {
        return false;
    }

    console.log(
        '[vavoo] logical playlist stalled "' + group.name +
        '" variant="' + variant.name +
        '" age_ms=' + ageMs +
        ' threshold_ms=' + stallMs +
        ' last_sequence=' + previous.sequence
    );
    return true;
}

function getLogicalMediaHealthKey(group, variant) {
    return group.id + '|' + variant.id;
}

async function fetchLogicalMediaProbeAsset(req, segmentUrl) {
    const cacheKey = getHlsAssetCacheKey(segmentUrl);
    const cached = cache.get(cacheKey);
    if (cached && cached.kind === 'asset' && cached.body) {
        return cached;
    }

    const upstreamLabel = describeHlsAssetUrl(segmentUrl);
    const parentSignal = AbortSignal.timeout(LOGICAL_MEDIA_PROBE_TIMEOUT_MS);
    const started = startSharedHlsAssetFetch(
        req,
        segmentUrl,
        parentSignal,
        upstreamLabel
    );

    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error('logical media probe timeout'));
        }, LOGICAL_MEDIA_PROBE_TIMEOUT_MS);
    });

    try {
        const result = await Promise.race([started.promise, timeout]);
        if (!result || result.kind !== 'asset' || !result.body) {
            throw new Error('logical media probe returned no asset');
        }
        cacheHlsAsset(cacheKey, result);
        return result;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function isLogicalVariantMediaLive(req, group, variant, upstream) {
    if (!upstream || upstream.stale || group.variants.length < 2) {
        return true;
    }

    const key = getLogicalMediaHealthKey(group, variant);
    const healthyUntil = logicalMediaHealth.get(key) || 0;
    if (healthyUntil > Date.now()) {
        return true;
    }

    const segments = getMediaPlaylistSegments(
        upstream.streamUrl,
        upstream.playlist
    );
    if (!segments.length) {
        return true;
    }

    // EN: Probe the first segments Kodi is about to consume, not only the
    // newest live-edge segments. One successful payload is enough to prove
    // that the playlist points to reachable media.
    // FR : Sonde les premiers segments que Kodi va consommer, pas seulement
    // ceux du bord du direct. Un seul payload réussi suffit à valider le média.
    const candidates = segments.slice(0, Math.min(2, segments.length));

    try {
        const winner = await Promise.any(
            candidates.map(async (segment) => {
                const asset = await fetchLogicalMediaProbeAsset(req, segment.url);
                return { segment, asset };
            })
        );
        logicalMediaHealth.set(
            key,
            Date.now() + LOGICAL_MEDIA_HEALTH_CACHE_MS
        );
        console.log(
            '[vavoo] logical media probe ok "' + group.name +
            '" variant="' + variant.name +
            '" sequence=' + winner.segment.sequence
        );
        return true;
    } catch (error) {
        logicalMediaHealth.delete(key);
        console.log(
            '[vavoo] logical media unavailable "' + group.name +
            '" variant="' + variant.name +
            '" candidates=' + candidates.length +
            ' timeout_ms=' + LOGICAL_MEDIA_PROBE_TIMEOUT_MS
        );
        return false;
    }
}
`;

replaceExactlyOnce(
  '\nfunction findLogicalPersistedVariant(group, variantId, variantName) {',
  '\n' + playlistProgressHelpers +
    '\nfunction findLogicalPersistedVariant(group, variantId, variantName) {',
  'logical playlist and media watchdog insertion'
);

replaceExactlyOnce(
  `            markLogicalVariantSuccess(group, variant);
            return { ...upstream, variant };`,
  `            if (isLogicalPlaylistStalled(group, variant, upstream)) {
                cache.del(getStreamUrlCacheKey(variant));
                cache.del(getPlaylistCacheKey(variant));
                markLogicalVariantFailure(
                    group,
                    variant,
                    'fresh playlist stopped advancing'
                );
                continue;
            }

            if (!await isLogicalVariantMediaLive(
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

            markLogicalVariantSuccess(group, variant);
            return { ...upstream, variant };`,
  'logical stalled-playlist and media-liveness failover hook'
);

const rankingStartMarker =
  'async function getRankedLogicalVariants(req, group) {';
const rankingEndMarker =
  '\n\nasync function fetchLogicalChannelPlaylist(req, group) {';
const rankingStart = source.indexOf(rankingStartMarker);
const rankingEnd = source.indexOf(rankingEndMarker, rankingStart);

if (rankingStart === -1 || rankingEnd === -1) {
  throw new Error('unable to locate logical quality ranking function');
}

const rankingReplacement = String.raw`const LOGICAL_QUALITY_RANKING_BUDGET_MS = 12000;

async function collectLogicalQualityWithinBudget(req, group, healthy) {
    const completed = new Map();
    const tasks = healthy.map((variant, index) =>
        probeLogicalVariantQuality(req, group, variant).then((quality) => {
            completed.set(variant.id, { variant, index, quality });
            return quality;
        })
    );
    const allDone = Promise.allSettled(tasks);
    let budgetReached = false;
    let timeoutId = null;

    if (healthy.length && LOGICAL_QUALITY_RANKING_BUDGET_MS > 0) {
        await Promise.race([
            allDone,
            new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    budgetReached = true;
                    resolve();
                }, LOGICAL_QUALITY_RANKING_BUDGET_MS);
            })
        ]);
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    } else {
        await allDone;
    }

    const measured = healthy
        .map((variant) => completed.get(variant.id))
        .filter(Boolean);
    const pending = healthy.filter(
        (variant) => !completed.has(variant.id)
    );

    if (budgetReached && pending.length) {
        console.log(
            '[vavoo] logical quality ranking budget reached "' +
            group.name + '" completed=' + measured.length +
            ' pending=' + pending.length +
            ' budget_ms=' + LOGICAL_QUALITY_RANKING_BUDGET_MS +
            ' pending_variants="' +
            pending.map((variant) => variant.name).join(',') + '"'
        );
    }

    return { measured, pending };
}

async function getRankedLogicalVariants(req, group) {
    const state = getLogicalVariantState(group);
    const ordered = getOrderedLogicalVariants(group);
    const active = ordered.find(
        (variant) => variant.id === state.activeVariantId &&
            !state.quarantinedUntil.has(variant.id)
    );

    if (active) {
        if (!LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
            return ordered;
        }
        const activeQuality = getLogicalQualityCached(group, active);
        // EN: A restored active variant is validated once because quality
        // measurements are intentionally not persisted across restarts.
        // Quality-cache expiry alone must not unstick a healthy active variant
        // later during established playback.
        // FR : Une variante active restaurée est validée une seule fois car
        // les mesures qualité ne sont volontairement pas persistées. Ensuite,
        // l'expiration du cache qualité seule ne doit pas déverrouiller une
        // variante active saine pendant la lecture.
        if (!activeQuality) {
            if (!state.restoredActiveNeedsValidation) {
                return ordered;
            }
            console.log(
                '[vavoo] logical restored active quality validation "' +
                group.name + '" variant="' + active.name + '"'
            );
        } else if (!isLogicalAudioBlocked(activeQuality)) {
            return ordered;
        }
        if (activeQuality && isLogicalAudioBlocked(activeQuality)) {
            console.log(
                '[vavoo] logical audio language rejects active variant "' + group.name +
                '" variant="' + active.name +
                '" languages=' + (activeQuality.audioLanguages || []).join(',')
            );
        }
    }

    if (
        !LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED &&
        (!LOGICAL_QUALITY_RANKING_ENABLED || group.variants.length < 2)
    ) {
        return ordered;
    }

    const healthy = ordered.filter(
        (variant) => !state.quarantinedUntil.has(variant.id)
    );
    const quarantined = ordered.filter(
        (variant) => state.quarantinedUntil.has(variant.id)
    );

    const collected = await collectLogicalQualityWithinBudget(
        req,
        group,
        healthy
    );
    const measured = collected.measured;
    const pendingHealthy = collected.pending;

    measured.sort((left, right) => {
        if (LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
            const languageDifference =
                getLogicalAudioLanguageRank(right.quality) -
                getLogicalAudioLanguageRank(left.quality);
            if (languageDifference) {
                return languageDifference;
            }
        }
        if (LOGICAL_QUALITY_RANKING_ENABLED) {
            const scoreDifference = right.quality.score - left.quality.score;
            if (scoreDifference) {
                return scoreDifference;
            }
        }
        return left.index - right.index;
    });

    const allowedMeasured = measured.filter(
        (entry) => !isLogicalAudioBlocked(entry.quality)
    );
    const allowedSuccessfulMeasured = allowedMeasured.filter(
        (entry) => !entry.quality.error
    );
    const allowedFailedMeasured = allowedMeasured.filter(
        (entry) => Boolean(entry.quality.error)
    );
    const allowedQuarantined = quarantined.filter((variant) => {
        const quality = getLogicalQualityCached(group, variant);
        return !quality || !isLogicalAudioBlocked(quality);
    });

    console.log(
        '[vavoo] logical quality ranking "' + group.name + '" ' +
        measured.map((entry) =>
            entry.variant.name + '=' + entry.quality.score +
            '[' + entry.quality.audioLanguageClass + ':' +
            ((entry.quality.audioLanguages || []).join(',') || 'unknown') + ']'
        ).join(' > ') +
        (pendingHealthy.length
            ? ' pending=' + pendingHealthy.map((variant) => variant.name).join(',')
            : '')
    );

    if (
        !allowedSuccessfulMeasured.length &&
        !pendingHealthy.length &&
        !allowedFailedMeasured.length &&
        !allowedQuarantined.length
    ) {
        console.log(
            '[vavoo] logical audio language blocked every variant "' +
            group.name + '"'
        );
    }

    return [
        ...allowedSuccessfulMeasured.map((entry) => entry.variant),
        ...pendingHealthy,
        ...allowedFailedMeasured.map((entry) => entry.variant),
        ...allowedQuarantined
    ];
}`;

source =
  source.slice(0, rankingStart) +
  rankingReplacement +
  source.slice(rankingEnd);

replaceExactlyOnce(
  `    const active = group.variants.find(
        (variant) => variant.id === state.activeVariantId
    );
    const quarantines = [];`,
  `    const active = group.variants.find(
        (variant) => variant.id === state.activeVariantId
    );
    const saved = logicalPersistentState.groups[group.id];
    const activeQuality = active
        ? getLogicalQualityCached(group, active)
        : null;
    const activeLanguageClass = String(
        activeQuality && activeQuality.audioLanguageClass || 'unknown'
    );
    let persistentActive = active;

    if (active && activeLanguageClass === 'other' && saved) {
        const previous = findLogicalPersistedVariant(
            group,
            saved.activeVariantId,
            saved.activeVariantName
        );
        if (previous && previous.id !== active.id) {
            persistentActive = previous;
            console.log(
                '[vavoo] logical state keeps preferred variant "' +
                group.name + '" active="' + previous.name +
                '" runtime_fallback="' + active.name + '"'
            );
        }
    }

    const quarantines = [];`,
  'persistent foreign-fallback guard prelude'
);

replaceExactlyOnce(
  `        activeVariantId: active ? active.id : null,
        activeVariantName: active ? active.name : null,`,
  `        activeVariantId: persistentActive ? persistentActive.id : null,
        activeVariantName: persistentActive ? persistentActive.name : null,`,
  'persistent foreign-fallback guard fields'
);

if (
  !source.includes('logical playlist stalled') ||
  !source.includes('VAVOO_LOGICAL_PLAYLIST_STALL_SECONDS') ||
  !source.includes('logical media unavailable') ||
  !source.includes('playlist reachable but media segments unavailable') ||
  !source.includes('logical state keeps preferred variant') ||
  !source.includes("classification === 'unknown' || classification === 'disabled'") ||
  !source.includes('LOGICAL_QUALITY_RANKING_BUDGET_MS = 12000') ||
  !source.includes('logical quality ranking budget reached') ||
  !source.includes('pendingHealthy')
) {
  throw new Error('logical source-selection hardening verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical source language priority, bounded quality ranking, playlist/media watchdogs and persistence guard: ' +
  target
);
