import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node harden-hls-playlist-latency.mjs <index.js>');
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
  'const PLAYLIST_REFRESH_RETRY_DELAYS_MS = [0, 250, 750];',
  `const PLAYLIST_REFRESH_RETRY_DELAYS_MS = [0, 250, 750];
const PLAYLIST_HEDGE_DELAY_MS = readIntegerEnvironment(
    'VAVOO_PLAYLIST_HEDGE_DELAY_MS',
    1000,
    0,
    10000
);
const PLAYLIST_FAST_FALLBACK_MS = readIntegerEnvironment(
    'VAVOO_PLAYLIST_FAST_FALLBACK_MS',
    3000,
    0,
    30000
);`,
  'playlist hedge settings insertion'
);

replaceExactlyOnce(
  `async function fetchPlaylistOnce(req, streamUrl) {
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
}`,
  `async function fetchPlaylistResponse(req, streamUrl, signal) {
    const upstream = await fetch(streamUrl, {
        headers: getStreamHeaders(req),
        signal
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

async function fetchPlaylistOnce(req, streamUrl) {
    return fetchPlaylistResponse(
        req,
        streamUrl,
        AbortSignal.timeout(30000)
    );
}

async function fetchPlaylistHedgedOnce(req, channel, streamUrl) {
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(PLAYLIST_FAST_FALLBACK_MS);
    const signal = AbortSignal.any([controller.signal, deadline]);
    let hedgeStarted = false;

    const attempts = [
        fetchPlaylistResponse(req, streamUrl, signal).then((result) => ({
            source: 'primary',
            result
        }))
    ];

    if (
        PLAYLIST_HEDGE_DELAY_MS > 0 &&
        PLAYLIST_HEDGE_DELAY_MS < PLAYLIST_FAST_FALLBACK_MS
    ) {
        attempts.push((async () => {
            await sleepMs(PLAYLIST_HEDGE_DELAY_MS);
            if (controller.signal.aborted) {
                throw new Error('playlist hedge cancelled');
            }

            hedgeStarted = true;
            console.log(
                '[vavoo] playlist hedge started "' + channel.name +
                '" delay_ms=' + PLAYLIST_HEDGE_DELAY_MS
            );

            const result = await fetchPlaylistResponse(
                req,
                streamUrl,
                signal
            );
            return { source: 'hedge', result };
        })());
    }

    try {
        const winner = await Promise.any(attempts);
        if (winner.source === 'hedge') {
            console.log(
                '[vavoo] playlist hedge won "' + channel.name + '"'
            );
        } else if (hedgeStarted) {
            console.log(
                '[vavoo] playlist primary won after hedge "' +
                channel.name + '"'
            );
        }
        controller.abort();
        return winner.result;
    } catch (error) {
        controller.abort();
        if (deadline.aborted) {
            throw new Error(
                'playlist fast fallback deadline exceeded after ' +
                PLAYLIST_FAST_FALLBACK_MS + 'ms'
            );
        }

        if (error && Array.isArray(error.errors) && error.errors.length) {
            throw error.errors[error.errors.length - 1];
        }
        throw error;
    }
}`,
  'playlist hedged fetch insertion'
);

replaceExactlyOnce(
  `    const stalePlaylist = cache.get(playlistCacheKey);
    let lastError;

    try {`,
  `    const stalePlaylist = cache.get(playlistCacheKey);
    let lastError;

    // EN: Established playback must never wait for the legacy 30 s playlist
    // retry path when a last-known-good playlist can keep the player polling.
    // FR : Une lecture établie ne doit jamais attendre l'ancien chemin de
    // retry de 30 s lorsqu'une dernière playlist valide peut maintenir le polling.
    if (stalePlaylist && PLAYLIST_FAST_FALLBACK_MS > 0) {
        try {
            const streamUrl = await getCachedStreamUrl(channel, false);
            const result = await fetchPlaylistHedgedOnce(
                req,
                channel,
                streamUrl
            );
            cache.set(
                playlistCacheKey,
                result,
                PLAYLIST_CACHE_TTL_SECONDS
            );
            return { ...result, stale: false };
        } catch (error) {
            lastError = error;
            cache.del(getStreamUrlCacheKey(channel));
            console.log(
                '[vavoo] serving last valid playlist quickly "' +
                channel.name + '" budget_ms=' +
                PLAYLIST_FAST_FALLBACK_MS + ' error="' +
                lastError.message + '"'
            );
            return {
                ...stalePlaylist,
                stale: true,
                fastFallback: true
            };
        }
    }

    try {`,
  'fast stale-playlist fallback insertion'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched hedged HLS playlist fetch and fast stale fallback: ' +
  target
);
