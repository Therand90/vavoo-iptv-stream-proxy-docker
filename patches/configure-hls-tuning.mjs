import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node configure-hls-tuning.mjs <index.js>');
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
  'const PLAYLIST_CACHE_TTL_SECONDS = 300;',
  `function readIntegerEnvironment(name, fallback, minimum, maximum) {
    const configured = Number.parseInt(process.env[name] || '', 10);
    if (!Number.isFinite(configured)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, configured));
}

const PLAYLIST_CACHE_TTL_SECONDS = readIntegerEnvironment(
    'VAVOO_PLAYLIST_CACHE_TTL_SECONDS',
    300,
    30,
    3600
);`,
  'playlist cache environment setting insertion'
);

replaceExactlyOnce(
  'const HLS_ASSET_CACHE_TTL_SECONDS = 45;',
  `const HLS_ASSET_CACHE_TTL_SECONDS = readIntegerEnvironment(
    'VAVOO_HLS_ASSET_CACHE_TTL_SECONDS',
    120,
    1,
    600
);`,
  'HLS asset cache TTL environment setting insertion'
);

replaceExactlyOnce(
  'const HLS_ASSET_MAX_CACHE_BYTES = 12 * 1024 * 1024;',
  `const HLS_ASSET_MAX_CACHE_BYTES = readIntegerEnvironment(
    'VAVOO_HLS_ASSET_MAX_CACHE_BYTES',
    12 * 1024 * 1024,
    256 * 1024,
    64 * 1024 * 1024
);`,
  'HLS asset cache size environment setting insertion'
);

replaceExactlyOnce(
  'const HLS_PREFETCH_SEGMENT_COUNT = 2;',
  `const HLS_PREFETCH_SEGMENT_COUNT = readIntegerEnvironment(
    'VAVOO_HLS_PREFETCH_SEGMENT_COUNT',
    2,
    0,
    10
);`,
  'HLS prefetch count environment setting insertion'
);

replaceExactlyOnce(
  '    return [...new Set(assetUrls)].slice(-HLS_PREFETCH_SEGMENT_COUNT);',
  `    if (HLS_PREFETCH_SEGMENT_COUNT === 0) {
        return [];
    }

    return [...new Set(assetUrls)].slice(-HLS_PREFETCH_SEGMENT_COUNT);`,
  'HLS prefetch disable switch insertion'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched bounded HLS tuning environment settings: ' + target
);
