import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-hls-retries.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function replaceExactlyOnce(search, replacement, description) {
  const occurrences = source.split(search).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      `${description}: expected exactly one match, found ${occurrences}`
    );
  }

  source = source.replace(search, replacement);
}

replaceExactlyOnce(
  "const STREAM_URL_CACHE_PREFIX = 'vavoo_stream_url:';",
  [
    "const STREAM_URL_CACHE_PREFIX = 'vavoo_stream_url:';",
    "const PLAYLIST_CACHE_PREFIX = 'vavoo_last_playlist:';",
    'const PLAYLIST_CACHE_TTL_SECONDS = 300;',
    'const PLAYLIST_RETRY_DELAYS_MS = [0, 200, 500];',
    'const PLAYLIST_REFRESH_RETRY_DELAYS_MS = [0, 250, 750];'
  ].join('\n'),
  'playlist resilience constants insertion'
);

const startMarker =
  'async function fetchChannelPlaylist(req, channel, forceRefresh = false) {';
const endMarker = '\n\nasync function proxyStream(req, res, streamUrl, channelName) {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error('unable to locate fetchChannelPlaylist in patched upstream');
}

const replacement = `function getPlaylistCacheKey(channel) {
    return PLAYLIST_CACHE_PREFIX + channel.id;
}

function sleepMs(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchPlaylistOnce(req, streamUrl) {
    const upstream = await fetch(streamUrl, {
        headers: getStreamHeaders(req),
        signal: AbortSignal.timeout(30000)
    });

    if (!upstream.ok || !upstream.body) {
        throw new Error('upstream returned HTTP ' + upstream.status);
    }

    const contentType = upstream.headers.get('content-type');
    if (!isM3u8Response(streamUrl, contentType)) {
        throw new Error(
            'upstream did not return an HLS playlist (' +
            (contentType || 'unknown') + ')'
        );
    }

    return {
        streamUrl,
        status: upstream.status,
        playlist: await upstream.text()
    };
}

async function fetchPlaylistWithRetries(
    req,
    channel,
    forceRefresh,
    retryDelays
) {
    const streamUrl = await getCachedStreamUrl(channel, forceRefresh);
    let lastError;

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        const delayMs = retryDelays[attempt];
        if (delayMs > 0) {
            await sleepMs(delayMs);
        }

        try {
            const result = await fetchPlaylistOnce(req, streamUrl);
            if (attempt > 0) {
                console.log(
                    '[vavoo] playlist recovered "' + channel.name +
                    '" attempt=' + (attempt + 1)
                );
            }
            return result;
        } catch (error) {
            lastError = error;
            console.log(
                '[vavoo] playlist retry "' + channel.name +
                '" attempt=' + (attempt + 1) + '/' + retryDelays.length +
                ' error="' + error.message + '"'
            );
        }
    }

    throw lastError;
}

async function fetchChannelPlaylist(req, channel) {
    const playlistCacheKey = getPlaylistCacheKey(channel);
    const stalePlaylist = cache.get(playlistCacheKey);
    let lastError;

    try {
        const result = await fetchPlaylistWithRetries(
            req,
            channel,
            false,
            PLAYLIST_RETRY_DELAYS_MS
        );
        cache.set(
            playlistCacheKey,
            result,
            PLAYLIST_CACHE_TTL_SECONDS
        );
        return { ...result, stale: false };
    } catch (error) {
        lastError = error;
    }

    if (stalePlaylist) {
        cache.del(getStreamUrlCacheKey(channel));
        console.log(
            '[vavoo] serving last valid playlist "' + channel.name +
            '" after transient error="' + lastError.message + '"'
        );
        return { ...stalePlaylist, stale: true };
    }

    try {
        const result = await fetchPlaylistWithRetries(
            req,
            channel,
            true,
            PLAYLIST_REFRESH_RETRY_DELAYS_MS
        );
        cache.set(
            playlistCacheKey,
            result,
            PLAYLIST_CACHE_TTL_SECONDS
        );
        return { ...result, stale: false };
    } catch (error) {
        lastError = error;
    }

    throw lastError;
}`;

source = source.slice(0, start) + replacement + source.slice(end);

writeFileSync(target, source, 'utf8');
console.log(
  `[therand] patched transient HLS retries and stale-playlist fallback: ${target}`
);
