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
const CHANNELS_SNAPSHOT_FILE = '/data/channels-cache.json';
const CHANNELS_SNAPSHOT_MAX_AGE_SECONDS = 172800;
let channelsLoadInflight = null;
let channelsSnapshotChecked = false;
const SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';`,
  'catalog cache constant insertion'
);

const catalogHelpers = `
function readChannelsSnapshot() {
    if (channelsSnapshotChecked) {
        return null;
    }
    channelsSnapshotChecked = true;

    try {
        const fileSystem = require('node:fs');
        if (!fileSystem.existsSync(CHANNELS_SNAPSHOT_FILE)) {
            return null;
        }

        const parsed = JSON.parse(
            fileSystem.readFileSync(CHANNELS_SNAPSHOT_FILE, 'utf8')
        );
        const savedAt = Number(parsed && parsed.savedAt);
        const channels = parsed && parsed.channels;
        if (!Number.isFinite(savedAt) || !Array.isArray(channels) || !channels.length) {
            throw new Error('invalid catalog snapshot structure');
        }

        const ageSeconds = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
        if (ageSeconds > CHANNELS_SNAPSHOT_MAX_AGE_SECONDS) {
            console.log(
                '[vavoo] channels snapshot ignored age=' + ageSeconds + 's'
            );
            return null;
        }

        const stale = ageSeconds >= CHANNELS_CACHE_TTL_SECONDS;
        const ttlSeconds = stale
            ? 300
            : Math.max(300, CHANNELS_CACHE_TTL_SECONDS - ageSeconds);
        cache.set(CHANNELS_CACHE_KEY, channels, ttlSeconds);
        console.log(
            '[vavoo] channels snapshot restored: ' + channels.length +
            ' age=' + ageSeconds + 's stale=' + stale
        );
        return { channels, stale };
    } catch (error) {
        console.log(
            '[vavoo] channels snapshot load skipped: ' +
            String(error && error.message ? error.message : error)
        );
        return null;
    }
}

function writeChannelsSnapshot(channels) {
    try {
        const fileSystem = require('node:fs');
        const temporary = CHANNELS_SNAPSHOT_FILE + '.tmp-' + process.pid;
        fileSystem.writeFileSync(
            temporary,
            JSON.stringify({ version: 1, savedAt: Date.now(), channels }) + '\\n',
            { encoding: 'utf8', mode: 0o600 }
        );
        fileSystem.renameSync(temporary, CHANNELS_SNAPSHOT_FILE);
    } catch (error) {
        console.log(
            '[vavoo] channels snapshot save skipped: ' +
            String(error && error.message ? error.message : error)
        );
    }
}

async function refreshChannelsCatalog() {
    if (channelsLoadInflight) {
        console.log('[vavoo] channels load joined existing request');
        return channelsLoadInflight;
    }

    channelsLoadInflight = (async () => {
        const signature = await getAddonSignature();

        for (const baseUrl of baseSites) {
            try {
                const channels = await loadCatalogFromBase(baseUrl, signature);
                cache.set(
                    CHANNELS_CACHE_KEY,
                    channels,
                    CHANNELS_CACHE_TTL_SECONDS
                );
                writeChannelsSnapshot(channels);
                console.log(
                    '[vavoo] channels loaded from ' + baseUrl + ': ' +
                    channels.length
                );
                return channels;
            } catch (error) {
                console.log(
                    '[vavoo] catalog load failed for ' + baseUrl + ': ' +
                    error.message
                );
            }
        }

        throw new Error('Unable to load channel catalog');
    })();

    try {
        return await channelsLoadInflight;
    } finally {
        channelsLoadInflight = null;
    }
}
`;

replaceExactlyOnce(
  '\nasync function getChannels(forceRefresh = false) {',
  '\n' + catalogHelpers + '\nasync function getChannels(forceRefresh = false) {',
  'catalog snapshot and in-flight helpers insertion'
);

replaceExactlyOnce(
  `async function getChannels(forceRefresh = false) {
    if (forceRefresh) {
        cache.del(CHANNELS_CACHE_KEY);
    }

    const cached = cache.get(CHANNELS_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const signature = await getAddonSignature();

    for (const baseUrl of baseSites) {
        try {
            const channels = await loadCatalogFromBase(baseUrl, signature);
            cache.set(CHANNELS_CACHE_KEY, channels, 300);
            console.log(\`[vavoo] channels loaded from ${baseUrl}: ${channels.length}\`);
            return channels;
        } catch (error) {
            console.log(\`[vavoo] catalog load failed for ${baseUrl}: ${error.message}\`);
        }
    }

    throw new Error('Unable to load channel catalog');
}`,
  `async function getChannels(forceRefresh = false) {
    if (forceRefresh) {
        cache.del(CHANNELS_CACHE_KEY);
    }

    if (!forceRefresh) {
        const cached = cache.get(CHANNELS_CACHE_KEY);
        if (cached) {
            return cached;
        }

        const snapshot = readChannelsSnapshot();
        if (snapshot) {
            if (snapshot.stale) {
                void refreshChannelsCatalog().catch((error) => {
                    console.log(
                        '[vavoo] background catalog refresh failed: ' +
                        error.message
                    );
                });
            }
            return snapshot.channels;
        }
    }

    return refreshChannelsCatalog();
}`,
  'catalog in-flight deduplication and snapshot restore'
);

replaceExactlyOnce(
  `app.listen(port, () => {
    const baseUrl = getLocalBaseUrl();
    console.log(\`Listening on ${baseUrl}/\`);
    console.log(\`M3U: ${baseUrl}/channels.m3u8\`);
    console.log(\`Example filtered M3U: ${baseUrl}/channels.m3u8?country=Germany\`);
    console.log(\`Countries: ${baseUrl}/countries\`);
});`,
  `app.listen(port, () => {
    const baseUrl = getLocalBaseUrl();
    console.log(\`Listening on ${baseUrl}/\`);
    console.log(\`M3U: ${baseUrl}/channels.m3u8\`);
    console.log(\`Example filtered M3U: ${baseUrl}/channels.m3u8?country=Germany\`);
    console.log(\`Countries: ${baseUrl}/countries\`);

    void getChannels()
        .then((channels) => {
            console.log(
                '[vavoo] catalog warmup ready: ' + channels.length + ' channels'
            );
        })
        .catch((error) => {
            console.log('[vavoo] catalog warmup failed: ' + error.message);
        });
});`,
  'catalog startup warmup insertion'
);

if (
  !source.includes('channels load joined existing request') ||
  !source.includes('channels snapshot restored') ||
  !source.includes('catalog warmup ready')
) {
  throw new Error('catalog cold-start hardening verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  `[therand] patched VAVOO catalog cache TTL, snapshot, dedupe and warmup: ${target}`
);
