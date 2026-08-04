import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node extend-catalog-cache.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function replaceExactlyOnce(search, replacement, description) {
  const occurrences = source.split(search).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      `${description}: expected exactly one upstream match, found ${occurrences}`
    );
  }

  source = source.replace(search, replacement);
}

replaceExactlyOnce(
  "const CHANNELS_CACHE_KEY = 'vavoo_channels';\nconst SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';",
  `const CHANNELS_CACHE_KEY = 'vavoo_channels';
const CHANNELS_CACHE_TTL_SECONDS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_CHANNELS_CACHE_TTL_SECONDS || '21600',
        10
    );

    return Number.isFinite(configured) && configured >= 300
        ? configured
        : 21600;
})();
const SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';`,
  'catalog cache constant insertion'
);

replaceExactlyOnce(
  'cache.set(CHANNELS_CACHE_KEY, channels, 300);',
  'cache.set(CHANNELS_CACHE_KEY, channels, CHANNELS_CACHE_TTL_SECONDS);',
  'catalog cache TTL replacement'
);

writeFileSync(target, source, 'utf8');
console.log(
  `[therand] patched VAVOO catalog cache TTL: ${target} ` +
  '(default 21600 seconds, minimum 300 seconds)'
);
