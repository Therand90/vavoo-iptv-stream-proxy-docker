import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node renew-hourly-hls.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function block(lines) {
  return lines.join('\n');
}

function replaceExactlyOnce(search, replacement, description) {
  const occurrences = source.split(search).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      description + ': expected exactly one upstream match, found ' + occurrences
    );
  }

  source = source.replace(search, replacement);
}

replaceExactlyOnce(
  "const SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';",
  block([
    "const SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';",
    "const STREAM_URL_CACHE_PREFIX = 'vavoo_stream_url:';",
    'const STREAM_URL_TTL_SECONDS = (() => {',
    '    const configured = Number.parseInt(',
    "        process.env.VAVOO_STREAM_URL_TTL_SECONDS || '3000',",
    '        10',
    '    );',
    '',
    '    return Number.isFinite(configured) && configured >= 300',
    '        ? configured',
    '        : 3000;',
    '})();'
  ]),
  'stream URL cache constants insertion'
);

replaceExactlyOnce(
  block([
    'function sendHlsMasterPlaylist(req, res, streamUrl) {',
    '    setPlaylistHeaders(res);',
    '    res.send([',
    "        '#EXTM3U',",
    "        '#EXT-X-VERSION:3',",
    "        '#EXT-X-STREAM-INF:BANDWIDTH=8000000',",
    '        getProxiedUpstreamUrl(req, streamUrl)',
    "    ].join('\\n') + '\\n');",
    '}'
  ]),
  block([
    'function getLocalChannelPlaylistUrl(req, channelId) {',
    "    return req.protocol + '://' + req.headers.host + '/hls-channel/' +",
    '        encodeURIComponent(channelId);',
    '}',
    '',
    'function sendHlsMasterPlaylist(req, res, channel) {',
    '    setPlaylistHeaders(res);',
    '    res.send([',
    "        '#EXTM3U',",
    "        '#EXT-X-VERSION:3',",
    "        '#EXT-X-STREAM-INF:BANDWIDTH=8000000',",
    '        getLocalChannelPlaylistUrl(req, channel.id)',
    "    ].join('\\n') + '\\n');",
    '}'
  ]),
  'renewable HLS master playlist replacement'
);

replaceExactlyOnce(
  'async function proxyStream(req, res, streamUrl, channelName) {',
  block([
    'function getStreamUrlCacheKey(channel) {',
    '    return STREAM_URL_CACHE_PREFIX + channel.id;',
    '}',
    '',
    'async function getCachedStreamUrl(channel, forceRefresh = false) {',
    '    const cacheKey = getStreamUrlCacheKey(channel);',
    '',
    '    if (forceRefresh) {',
    '        cache.del(cacheKey);',
    '    }',
    '',
    '    const cached = cache.get(cacheKey);',
    '    if (cached) {',
    '        return cached;',
    '    }',
    '',
    '    const streamUrl = await resolveStreamUrl(channel);',
    '    cache.set(cacheKey, streamUrl, STREAM_URL_TTL_SECONDS);',
    '    console.log(',
    "        '[vavoo] refreshed stream URL \"' + channel.name +",
    "        '\" ttl=' + STREAM_URL_TTL_SECONDS + 's'",
    '    );',
    '    return streamUrl;',
    '}',
    '',
    'async function fetchChannelPlaylist(req, channel, forceRefresh = false) {',
    '    const streamUrl = await getCachedStreamUrl(channel, forceRefresh);',
    '    const upstream = await fetch(streamUrl, {',
    '        headers: getStreamHeaders(req),',
    '        signal: AbortSignal.timeout(30000)',
    '    });',
    '',
    '    if (!upstream.ok || !upstream.body) {',
    '        if (!forceRefresh) {',
    '            console.log(',
    "                '[vavoo] playlist refresh required \"' + channel.name +",
    "                '\": HTTP ' + upstream.status",
    '            );',
    '            return fetchChannelPlaylist(req, channel, true);',
    '        }',
    '',
    "        throw new Error('upstream returned HTTP ' + upstream.status);",
    '    }',
    '',
    "    const contentType = upstream.headers.get('content-type');",
    '    if (!isM3u8Response(streamUrl, contentType)) {',
    '        throw new Error(',
    "            'upstream did not return an HLS playlist (' +",
    "            (contentType || 'unknown') + ')'",
    '        );',
    '    }',
    '',
    '    return {',
    '        streamUrl,',
    '        status: upstream.status,',
    '        playlist: await upstream.text()',
    '    };',
    '}',
    '',
    'async function proxyStream(req, res, streamUrl, channelName) {'
  ]),
  'renewable stream URL helpers insertion'
);

replaceExactlyOnce(
  block([
    '        setUpstreamHeaders(res, upstream);',
    '        res.status(upstream.status);',
    '        console.log(`[${connId}] hls asset "${upstreamLabel}" status=${upstream.status} type="${contentType || \'unknown\'}"`);',
    '        await pipeline(Readable.fromWeb(upstream.body), res);'
  ]),
  block([
    '        setUpstreamHeaders(res, upstream);',
    '        res.status(upstream.status);',
    '        console.log(`[${connId}] hls asset "${upstreamLabel}" status=${upstream.status} type="${contentType || \'unknown\'}"`);',
    '        const body = Buffer.from(await upstream.arrayBuffer());',
    '        res.send(body);'
  ]),
  'buffered HLS asset forwarding replacement'
);

replaceExactlyOnce(
  "app.get('/hls-proxy', async function (req, res) {",
  block([
    "app.get('/hls-channel/:id', async function (req, res) {",
    '    const connId = String(req.socket.remoteAddress);',
    '',
    '    try {',
    '        const channelId = normalizeStreamId(req.params.id);',
    '        const channel = await findChannelById(channelId);',
    '        if (!channel) {',
    "            res.status(404).send('unknown channel: ' + channelId);",
    '            return;',
    '        }',
    '',
    '        const upstream = await fetchChannelPlaylist(req, channel);',
    '        const rewrittenPlaylist = rewriteM3u8Playlist(',
    '            req,',
    '            upstream.streamUrl,',
    '            upstream.playlist',
    '        );',
    '        const debugInfo = getPlaylistDebugInfo(upstream.playlist);',
    '        console.log(',
    "            '[' + connId + '] renewable hls playlist \"' + channel.name +",
    "            '\" status=' + upstream.status +",
    "            ' sequence=' + debugInfo.sequence +",
    "            ' entries=' + debugInfo.segments",
    '        );',
    '        setPlaylistHeaders(res);',
    '        res.send(rewrittenPlaylist);',
    '    } catch (error) {',
    "        console.log('[' + connId + '] renewable hls error: ' + error.message);",
    '        if (!res.headersSent) {',
    "            res.status(502).send('renewable hls error: ' + error.message);",
    '        }',
    '    }',
    '});',
    '',
    "app.get('/hls-proxy', async function (req, res) {"
  ]),
  'renewable HLS route insertion'
);

replaceExactlyOnce(
  block([
    '        const streamUrl = await resolveStreamUrl(channel);',
    '        console.log(`[${connId}] resolved "${channel.name}": ${streamUrl}`);',
    '',
    "        if (redirect && userAgent.toLowerCase().includes('vavoo')) {",
    '            res.redirect(streamUrl);',
    '            return;',
    '        }',
    '',
    '        if (isM3u8Url(streamUrl)) {',
    '            console.log(`[${connId}] hls master playlist "${channel.name}"`);',
    '            sendHlsMasterPlaylist(req, res, streamUrl);',
    '            return;',
    '        }',
    '',
    '        await proxyStream(req, res, streamUrl, channel.name);'
  ]),
  block([
    '        if (!redirect) {',
    "            console.log('[' + connId + '] renewable hls master \"' + channel.name + '\"');",
    '            sendHlsMasterPlaylist(req, res, channel);',
    '            return;',
    '        }',
    '',
    '        const streamUrl = await resolveStreamUrl(channel);',
    '        console.log(`[${connId}] resolved "${channel.name}": ${streamUrl}`);',
    '',
    "        if (userAgent.toLowerCase().includes('vavoo')) {",
    '            res.redirect(streamUrl);',
    '            return;',
    '        }',
    '',
    '        if (isM3u8Url(streamUrl)) {',
    '            console.log(`[${connId}] hls master playlist "${channel.name}"`);',
    '            sendHlsMasterPlaylist(req, res, channel);',
    '            return;',
    '        }',
    '',
    '        await proxyStream(req, res, streamUrl, channel.name);'
  ]),
  'stream route renewable mode replacement'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched renewable hourly HLS playback: ' + target +
  ' (stream URL default TTL 3000 seconds)'
);
