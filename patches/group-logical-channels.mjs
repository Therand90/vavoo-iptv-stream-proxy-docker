import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node group-logical-channels.mjs <index.js>');
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

const routeMarker = "\n\napp.get('/', function (req, res) {";

const logicalChannelSupport = `
const LOGICAL_VARIANT_QUARANTINE_SECONDS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_VARIANT_QUARANTINE_SECONDS || '300',
        10
    );

    return Number.isFinite(configured) && configured >= 30
        ? Math.min(configured, 86400)
        : 300;
})();

const logicalVariantState = new Map();

function getLogicalChannelName(channelName) {
    const original = String(channelName || '').trim();
    let logicalName = original;

    logicalName = logicalName.replace(/\\s+\\.[bcs]\\s*$/i, '').trim();

    let previous;
    do {
        previous = logicalName;
        logicalName = logicalName.replace(
            /\\s+(?:FULL\\s*HD|FHD|UHD|HD|SD|4K)\\s*$/i,
            ''
        ).trim();
    } while (logicalName !== previous);

    return logicalName || original;
}

function getLogicalChannelIdentity(channelName) {
    return getLogicalChannelName(channelName)
        .normalize('NFKD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function getLogicalChannelId(name, country) {
    const seed = [
        'logical',
        normalize(country),
        getLogicalChannelIdentity(name)
    ].join('|');

    return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 22);
}

function groupLogicalChannels(channels) {
    const groups = new Map();

    for (const channel of channels) {
        const name = getLogicalChannelName(channel.name);
        const identity = getLogicalChannelIdentity(channel.name);
        const key = normalize(channel.country) + '|' + (identity || channel.id);

        let group = groups.get(key);
        if (!group) {
            group = {
                id: getLogicalChannelId(name || channel.name, channel.country),
                name: name || channel.name,
                country: channel.country,
                logo: channel.logo || '',
                variants: []
            };
            groups.set(key, group);
        }

        if (!group.logo && channel.logo) {
            group.logo = channel.logo;
        }

        group.variants.push(channel);
    }

    return [...groups.values()];
}

async function getLogicalChannelsByCountry(country) {
    const channels = country
        ? await getChannelsByCountry(country)
        : await getChannels();

    return groupLogicalChannels(channels);
}

async function findLogicalChannelById(id) {
    const groups = groupLogicalChannels(await getChannels());
    return groups.find((group) => String(group.id) === String(id));
}

function getLogicalVariantState(group) {
    let state = logicalVariantState.get(group.id);

    if (!state) {
        state = {
            activeVariantId: null,
            quarantinedUntil: new Map()
        };
        logicalVariantState.set(group.id, state);
    }

    const validIds = new Set(group.variants.map((variant) => variant.id));
    if (state.activeVariantId && !validIds.has(state.activeVariantId)) {
        state.activeVariantId = null;
    }

    for (const variantId of [...state.quarantinedUntil.keys()]) {
        if (!validIds.has(variantId)) {
            state.quarantinedUntil.delete(variantId);
        }
    }

    return state;
}

function getOrderedLogicalVariants(group) {
    const state = getLogicalVariantState(group);
    const now = Date.now();

    for (const [variantId, until] of [...state.quarantinedUntil.entries()]) {
        if (until <= now) {
            state.quarantinedUntil.delete(variantId);
        }
    }

    const active = group.variants.find(
        (variant) => variant.id === state.activeVariantId
    );
    const healthy = group.variants.filter(
        (variant) => !state.quarantinedUntil.has(variant.id)
    );
    const quarantined = group.variants
        .filter((variant) => state.quarantinedUntil.has(variant.id))
        .sort((left, right) =>
            state.quarantinedUntil.get(left.id) -
            state.quarantinedUntil.get(right.id)
        );

    const ordered = [];
    const seen = new Set();

    function append(variant) {
        if (!variant || seen.has(variant.id)) {
            return;
        }
        seen.add(variant.id);
        ordered.push(variant);
    }

    if (active && !state.quarantinedUntil.has(active.id)) {
        append(active);
    }
    for (const variant of healthy) {
        append(variant);
    }
    for (const variant of quarantined) {
        append(variant);
    }

    return ordered;
}

function markLogicalVariantFailure(group, variant, reason) {
    const state = getLogicalVariantState(group);
    const until = Date.now() + LOGICAL_VARIANT_QUARANTINE_SECONDS * 1000;
    state.quarantinedUntil.set(variant.id, until);

    if (state.activeVariantId === variant.id) {
        state.activeVariantId = null;
    }

    console.log(
        '[vavoo] logical variant quarantined "' + group.name +
        '" variant="' + variant.name +
        '" ttl=' + LOGICAL_VARIANT_QUARANTINE_SECONDS +
        's reason="' + reason + '"'
    );
}

function markLogicalVariantSuccess(group, variant) {
    const state = getLogicalVariantState(group);
    const previousId = state.activeVariantId;
    const previous = group.variants.find(
        (candidate) => candidate.id === previousId
    );

    state.quarantinedUntil.delete(variant.id);
    state.activeVariantId = variant.id;

    if (previousId !== variant.id) {
        console.log(
            '[vavoo] logical variant selected "' + group.name +
            '" variant="' + variant.name +
            '" previous="' + (previous ? previous.name : 'none') + '"'
        );
    }
}

async function fetchLogicalChannelPlaylist(req, group) {
    const variants = getOrderedLogicalVariants(group);
    let staleFallback = null;
    let lastError = null;

    for (const variant of variants) {
        try {
            const upstream = await fetchChannelPlaylist(req, variant);

            if (upstream.stale) {
                if (!staleFallback) {
                    staleFallback = { ...upstream, variant };
                }
                markLogicalVariantFailure(group, variant, 'stale playlist');
                continue;
            }

            markLogicalVariantSuccess(group, variant);
            return { ...upstream, variant };
        } catch (error) {
            lastError = error;
            markLogicalVariantFailure(
                group,
                variant,
                String(error && error.message ? error.message : 'unknown error')
            );
        }
    }

    if (staleFallback) {
        console.log(
            '[vavoo] logical fallback serving stale playlist "' + group.name +
            '" variant="' + staleFallback.variant.name + '"'
        );
        return staleFallback;
    }

    throw lastError || new Error(
        'Unable to obtain a playlist for logical channel ' + group.name
    );
}

function getLocalLogicalChannelPlaylistUrl(req, groupId) {
    return req.protocol + '://' + req.headers.host + '/hls-group/' +
        encodeURIComponent(groupId);
}

function sendLogicalHlsMasterPlaylist(req, res, group) {
    setPlaylistHeaders(res);
    res.send([
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-STREAM-INF:BANDWIDTH=8000000',
        getLocalLogicalChannelPlaylistUrl(req, group.id)
    ].join('\\n') + '\\n');
}

function getLogicalChannelHealth(group) {
    const state = getLogicalVariantState(group);
    const now = Date.now();
    const active = group.variants.find(
        (variant) => variant.id === state.activeVariantId
    );
    const variants = group.variants.map((variant) => {
        const until = state.quarantinedUntil.get(variant.id) || 0;
        return {
            name: variant.name,
            active: Boolean(active && active.id === variant.id),
            quarantined: until > now,
            quarantined_until: until > now ? Math.floor(until / 1000) : null
        };
    });

    return {
        id: group.id,
        name: group.name,
        country: group.country,
        status: active ? 'healthy' : 'unknown',
        active_variant: active ? active.name : null,
        variant_count: group.variants.length,
        variants
    };
}

app.get('/channel-groups', async function (req, res) {
    try {
        const groups = await getLogicalChannelsByCountry(req.query.country);
        res.json(groups.map(getLogicalChannelHealth));
    } catch (error) {
        console.log('[vavoo] channel-groups error', error.message);
        res.status(500).send(error.message);
    }
});

app.get('/channels-grouped.m3u8', async function (req, res) {
    try {
        const groups = await getLogicalChannelsByCountry(req.query.country);
        const output = ['#EXTM3U'];

        for (const group of groups) {
            output.push(
                '#EXTINF:-1 tvg-name="' + group.name +
                '" group-title="' + group.country +
                '" tvg-logo="' + group.logo +
                '" tvg-id="' + group.name + '",' + group.name
            );
            output.push('#EXTVLCOPT:http-user-agent=VAVOO/2.6');
            output.push('#EXTVLCOPT:no-ssl-verify');
            output.push(
                req.protocol + '://' + req.headers.host +
                '/stream-group/' + encodeURIComponent(group.id)
            );
        }

        setPlaylistHeaders(res);
        res.send(output.join('\\n'));
    } catch (error) {
        console.log('[vavoo] channels-grouped.m3u8 error', error.message);
        res.status(500).send(error.message);
    }
});

app.get('/stream-group/:id', async function (req, res) {
    const connId = String(req.socket.remoteAddress);

    try {
        const groupId = normalizeStreamId(req.params.id);
        const group = await findLogicalChannelById(groupId);
        if (!group) {
            res.status(404).send('unknown logical channel: ' + groupId);
            return;
        }

        console.log(
            '[' + connId + '] logical hls master "' + group.name + '"'
        );
        sendLogicalHlsMasterPlaylist(req, res, group);
    } catch (error) {
        console.log('[' + connId + '] logical stream error: ' + error.message);
        if (!res.headersSent) {
            res.status(502).send('logical stream error: ' + error.message);
        }
    }
});

app.get('/hls-group/:id', async function (req, res) {
    const connId = String(req.socket.remoteAddress);

    try {
        const groupId = normalizeStreamId(req.params.id);
        const group = await findLogicalChannelById(groupId);
        if (!group) {
            res.status(404).send('unknown logical channel: ' + groupId);
            return;
        }

        const upstream = await fetchLogicalChannelPlaylist(req, group);
        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            upstream.playlist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            upstream.variant.name
        );
        const debugInfo = getPlaylistDebugInfo(upstream.playlist);

        res.setHeader('X-Therand-Vavoo-Variant', upstream.variant.name);
        console.log(
            '[' + connId + '] logical hls playlist "' + group.name +
            '" variant="' + upstream.variant.name +
            '" status=' + upstream.status +
            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);
    } catch (error) {
        console.log(
            '[' + connId + '] logical hls error: ' + error.message
        );
        if (!res.headersSent) {
            res.status(502).send('logical hls error: ' + error.message);
        }
    }
});
`;

replaceExactlyOnce(
  routeMarker,
  '\n\n' + logicalChannelSupport + routeMarker,
  'logical channel routes insertion'
);

const samples = [
  ['CARTOON NETWORK .b', 'CARTOON NETWORK'],
  ['CARTOON NETWORK FHD .c', 'CARTOON NETWORK'],
  ['13 EME RUE HD .s', '13 EME RUE'],
  ['A LA CARTE 10 HD .s', 'A LA CARTE 10']
];

for (const [input, expected] of samples) {
  let candidate = String(input).trim().replace(/\s+\.[bcs]\s*$/i, '').trim();
  let previous;
  do {
    previous = candidate;
    candidate = candidate.replace(
      /\s+(?:FULL\s*HD|FHD|UHD|HD|SD|4K)\s*$/i,
      ''
    ).trim();
  } while (candidate !== previous);

  if (candidate !== expected) {
    throw new Error(
      'logical name self-test failed: ' + input + ' -> ' + candidate
    );
  }
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical VAVOO channel grouping and runtime failover: ' + target
);
