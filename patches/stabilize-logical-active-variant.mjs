import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node stabilize-logical-active-variant.mjs <index.js>');
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
  `const LOGICAL_ACTIVE_STALE_GRACE_SECONDS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_ACTIVE_STALE_GRACE_SECONDS || '8',
        10
    );
    return Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 300)
        : 8;
})();

const logicalVariantState = new Map();`,
  'logical active stale grace setting insertion'
);

replaceExactlyOnce(
  `        state = {
            activeVariantId: null,
            quarantinedUntil: new Map()
        };`,
  `        state = {
            activeVariantId: null,
            quarantinedUntil: new Map(),
            staleSinceByVariant: new Map(),
            restoredActiveNeedsValidation: false
        };`,
  'logical stale-state insertion'
);

replaceExactlyOnce(
  `    for (const variantId of [...state.quarantinedUntil.keys()]) {
        if (!validIds.has(variantId)) {
            state.quarantinedUntil.delete(variantId);
        }
    }

    return state;`,
  `    for (const variantId of [...state.quarantinedUntil.keys()]) {
        if (!validIds.has(variantId)) {
            state.quarantinedUntil.delete(variantId);
        }
    }
    for (const variantId of [...state.staleSinceByVariant.keys()]) {
        if (!validIds.has(variantId)) {
            state.staleSinceByVariant.delete(variantId);
        }
    }

    return state;`,
  'logical stale-state cleanup insertion'
);

replaceExactlyOnce(
  `    const state = getLogicalVariantState(group);
    const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds >= 30`,
  `    const state = getLogicalVariantState(group);
    state.staleSinceByVariant.delete(variant.id);
    const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds >= 30`,
  'logical stale-state failure cleanup'
);

replaceExactlyOnce(
  `    state.quarantinedUntil.delete(variant.id);
    state.activeVariantId = variant.id;`,
  `    state.quarantinedUntil.delete(variant.id);
    state.staleSinceByVariant.delete(variant.id);
    state.restoredActiveNeedsValidation = false;
    state.activeVariantId = variant.id;`,
  'logical stale-state success cleanup'
);

replaceExactlyOnce(
  `            if (upstream.stale) {
                if (!staleFallback) {
                    staleFallback = { ...upstream, variant };
                }
                markLogicalVariantFailure(group, variant, 'stale playlist');
                continue;
            }

            markLogicalVariantSuccess(group, variant);`,
  `            if (upstream.stale) {
                const state = getLogicalVariantState(group);
                const isActive = state.activeVariantId === variant.id;

                if (isActive && LOGICAL_ACTIVE_STALE_GRACE_SECONDS > 0) {
                    const now = Date.now();
                    const staleSince =
                        state.staleSinceByVariant.get(variant.id) || now;
                    state.staleSinceByVariant.set(variant.id, staleSince);
                    const staleAgeMs = now - staleSince;
                    const graceMs =
                        LOGICAL_ACTIVE_STALE_GRACE_SECONDS * 1000;

                    if (staleAgeMs < graceMs) {
                        console.log(
                            '[vavoo] logical active stale grace "' +
                            group.name + '" variant="' + variant.name +
                            '" age_ms=' + staleAgeMs +
                            ' grace_ms=' + graceMs
                        );
                        return { ...upstream, variant };
                    }
                }

                state.staleSinceByVariant.delete(variant.id);
                if (!staleFallback) {
                    staleFallback = { ...upstream, variant };
                }
                markLogicalVariantFailure(group, variant, 'stale playlist');
                continue;
            }

            markLogicalVariantSuccess(group, variant);`,
  'logical active stale grace behavior'
);

replaceExactlyOnce(
  `        const activeQuality = getLogicalQualityCached(group, active);
        if (activeQuality && !isLogicalAudioBlocked(activeQuality)) {
            return ordered;
        }`,
  `        const activeQuality = getLogicalQualityCached(group, active);
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
        }`,
  'logical restored-active one-shot quality validation'
);

if (
  !source.includes('restoredActiveNeedsValidation') ||
  !source.includes('logical restored active quality validation')
) {
  throw new Error('restored active quality validation verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched sticky logical variants, restored-active validation and stale-playlist grace: ' +
  target
);
