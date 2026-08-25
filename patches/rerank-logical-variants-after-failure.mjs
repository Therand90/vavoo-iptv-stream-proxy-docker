import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node rerank-logical-variants-after-failure.mjs <index.js>');
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
  `    if (active) {
        if (!LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
            return ordered;
        }
        const activeQuality = getLogicalQualityCached(group, active);`,
  `    if (active) {
        const activeQuality = getLogicalQualityCached(group, active);
        if (
            !LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED &&
            !(activeQuality && activeQuality.error)
        ) {
            return ordered;
        }`,
  'active quality lookup before sticky decision'
);

replaceExactlyOnce(
  `        } else if (!isLogicalAudioBlocked(activeQuality)) {
            return ordered;
        }
        if (activeQuality && isLogicalAudioBlocked(activeQuality)) {`,
  `        } else if (activeQuality.error) {
            console.log(
                '[vavoo] logical active quality error revalidation "' +
                group.name + '" variant="' + active.name +
                '" error="' + activeQuality.error + '"'
            );
        } else if (!isLogicalAudioBlocked(activeQuality)) {
            return ordered;
        }
        if (activeQuality && isLogicalAudioBlocked(activeQuality)) {`,
  'active quality error revalidation'
);

const cachedRerankHelpers = String.raw`
function getLogicalVariantsFromCachedQuality(group) {
    const state = getLogicalVariantState(group);
    const ordered = getOrderedLogicalVariants(group);
    const healthyEntries = ordered
        .filter((variant) => !state.quarantinedUntil.has(variant.id))
        .map((variant, index) => ({
            variant,
            index,
            quality: getLogicalQualityCached(group, variant)
        }))
        .filter((entry) =>
            !LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED ||
            !entry.quality ||
            !isLogicalAudioBlocked(entry.quality)
        );
    const quarantined = ordered.filter(
        (variant) => state.quarantinedUntil.has(variant.id)
    );

    const successful = healthyEntries.filter(
        (entry) => entry.quality && !entry.quality.error
    );
    const pending = healthyEntries.filter(
        (entry) => !entry.quality
    );
    const failed = healthyEntries.filter(
        (entry) => entry.quality && entry.quality.error
    );

    successful.sort((left, right) => {
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

    const allowedQuarantined = quarantined.filter((variant) => {
        const quality = getLogicalQualityCached(group, variant);
        return (
            !LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED ||
            !quality ||
            !isLogicalAudioBlocked(quality)
        );
    });

    return [
        ...successful.map((entry) => entry.variant),
        ...pending.map((entry) => entry.variant),
        ...failed.map((entry) => entry.variant),
        ...allowedQuarantined
    ];
}

function logicalLivePlaylistHasEndList(playlist) {
    return String(playlist || '')
        .split(/\r?\n/)
        .some((line) => line.trim().toUpperCase() === '#EXT-X-ENDLIST');
}
`;

replaceExactlyOnce(
  '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  '\n' + cachedRerankHelpers +
    '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  'cached logical reranking and live-ENDLIST helpers insertion'
);

replaceExactlyOnce(
  `async function fetchLogicalChannelPlaylist(req, group) {
    const variants = await getRankedLogicalVariants(req, group);
    let staleFallback = null;
    let lastError = null;

    for (const variant of variants) {`,
  `async function fetchLogicalChannelPlaylist(req, group) {
    let staleFallback = null;
    let lastError = null;
    const attemptedVariantIds = new Set();
    let firstSelection = true;

    while (attemptedVariantIds.size < group.variants.length) {
        const variants = firstSelection
            ? await getRankedLogicalVariants(req, group)
            : getLogicalVariantsFromCachedQuality(group);
        firstSelection = false;
        const variant = variants.find(
            (candidate) => !attemptedVariantIds.has(candidate.id)
        );

        if (!variant) {
            break;
        }

        if (attemptedVariantIds.size > 0) {
            console.log(
                '[vavoo] logical candidate reranking "' + group.name +
                '" attempted=' + attemptedVariantIds.size +
                ' next="' + variant.name + '"'
            );
        }
        attemptedVariantIds.add(variant.id);`,
  'dynamic logical candidate reranking loop'
);

replaceExactlyOnce(
  `        try {
            const upstream = await fetchChannelPlaylist(req, variant);

            if (upstream.stale) {`,
  `        try {
            const upstream = await fetchChannelPlaylist(req, variant);

            // EN: A logical group represents a live TV channel. ENDLIST means
            // this particular upstream variant has terminated and must never be
            // forwarded to Kodi as a normal end-of-program signal.
            // FR : Un groupe logique représente une chaîne TV en direct.
            // ENDLIST signifie que cette variante amont est terminée et ne doit
            // jamais être transmise à Kodi comme une fin de programme normale.
            if (logicalLivePlaylistHasEndList(upstream.playlist)) {
                const debugInfo = getPlaylistDebugInfo(upstream.playlist);
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
                    '" sequence=' + debugInfo.sequence +
                    ' entries=' + debugInfo.segments
                );
                markLogicalVariantFailure(
                    group,
                    variant,
                    'live playlist advertised EXT-X-ENDLIST'
                );
                continue;
            }

            if (upstream.stale) {`,
  'logical live ENDLIST rejection hook'
);

if (
  !source.includes('logical candidate reranking') ||
  !source.includes('getLogicalVariantsFromCachedQuality') ||
  !source.includes('logical active quality error revalidation') ||
  !source.includes('attemptedVariantIds') ||
  !source.includes('logicalLivePlaylistHasEndList') ||
  !source.includes('logical live playlist ended') ||
  !source.includes('live playlist advertised EXT-X-ENDLIST')
) {
  throw new Error('logical reranking-after-failure and live-ENDLIST verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched dynamic reranking after logical variant failure and live ENDLIST rejection: ' + target
);
