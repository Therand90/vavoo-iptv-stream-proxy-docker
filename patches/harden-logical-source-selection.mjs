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

const LOGICAL_MEDIA_PROBE_TIMEOUT_MS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_LOGICAL_MEDIA_PROBE_TIMEOUT_MS || '4500',
        10
    );
    return Number.isFinite(configured) && configured >= 1000
        ? Math.min(configured, 15000)
        : 4500;
})();

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
  !source.includes('VAVOO_LOGICAL_MEDIA_PROBE_TIMEOUT_MS') ||
  !source.includes('logical media unavailable') ||
  !source.includes('playlist reachable but media segments unavailable') ||
  !source.includes('logical state keeps preferred variant') ||
  !source.includes("classification === 'unknown' || classification === 'disabled'")
) {
  throw new Error('logical source-selection hardening verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical source language priority, playlist/media watchdogs and persistence guard: ' +
  target
);
