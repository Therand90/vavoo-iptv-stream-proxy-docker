import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node delay-hls-live-edge.mjs <index.js>');
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
  'async function proxyUpstreamUrl(req, res, upstreamUrl) {',
  `const HLS_LIVE_EDGE_DELAY_SEGMENTS = (() => {
    const configured = Number.parseInt(
        process.env.VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS || '2',
        10
    );
    return Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 6)
        : 2;
})();
const HLS_LIVE_EDGE_MIN_VISIBLE_SEGMENTS = 3;

function applyHlsLiveEdgeSafetyDelay(playlist) {
    const original = String(playlist || '');
    const lines = original.split(/\\r?\\n/);
    const trimmedLines = lines.map((line) => line.trim());

    if (
        HLS_LIVE_EDGE_DELAY_SEGMENTS < 1 ||
        HLS_PREFETCH_SEGMENT_COUNT < 1 ||
        trimmedLines.includes('#EXT-X-ENDLIST') ||
        !trimmedLines.some((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) ||
        !trimmedLines.some((line) => line.startsWith('#EXTINF:'))
    ) {
        return {
            playlist: original,
            hiddenSegments: 0,
            visibleSegments: 0,
            upstreamSegments: 0
        };
    }

    const segmentLineIndexes = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = trimmedLines[index];
        if (line && !line.startsWith('#')) {
            segmentLineIndexes.push(index);
        }
    }

    const upstreamSegments = segmentLineIndexes.length;
    const maxSafeDelay = Math.max(
        0,
        upstreamSegments - HLS_LIVE_EDGE_MIN_VISIBLE_SEGMENTS
    );
    const hiddenSegments = Math.min(
        HLS_LIVE_EDGE_DELAY_SEGMENTS,
        HLS_PREFETCH_SEGMENT_COUNT,
        maxSafeDelay
    );

    if (hiddenSegments < 1) {
        return {
            playlist: original,
            hiddenSegments: 0,
            visibleSegments: upstreamSegments,
            upstreamSegments
        };
    }

    const visibleSegments = upstreamSegments - hiddenSegments;
    const lastVisibleLine = segmentLineIndexes[visibleSegments - 1];
    const delayedPlaylist = lines
        .slice(0, lastVisibleLine + 1)
        .join('\\n') + '\\n';

    return {
        playlist: delayedPlaylist,
        hiddenSegments,
        visibleSegments,
        upstreamSegments
    };
}

async function proxyUpstreamUrl(req, res, upstreamUrl) {`,
  'HLS live-edge safety helper insertion'
);

replaceExactlyOnce(
  `        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            upstream.playlist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            channel.name
        );`,
  `        const liveEdge = applyHlsLiveEdgeSafetyDelay(upstream.playlist);
        const rewrittenPlaylist = rewriteM3u8Playlist(
            req,
            upstream.streamUrl,
            liveEdge.playlist
        );
        prefetchPlaylistSegments(
            req,
            upstream.streamUrl,
            upstream.playlist,
            channel.name
        );`,
  'renewable HLS live-edge delay insertion'
);

replaceExactlyOnce(
  `        const logicalPlaylist = rewriteLogicalPlaylistTimeline(
            group,
            upstream.variant,
            upstream.playlist
        );`,
  `        const liveEdge = applyHlsLiveEdgeSafetyDelay(upstream.playlist);
        const logicalPlaylist = rewriteLogicalPlaylistTimeline(
            group,
            upstream.variant,
            liveEdge.playlist
        );`,
  'logical HLS live-edge delay insertion'
);

replaceExactlyOnce(
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments +
            ' safety_delay=' + liveEdge.hiddenSegments +
            ' visible=' + liveEdge.visibleSegments
        );
        res.setHeader(
            'X-Therand-Vavoo-Live-Edge-Delay-Segments',
            String(liveEdge.hiddenSegments)
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  'renewable HLS live-edge diagnostics'
);

replaceExactlyOnce(
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  `            ' sequence=' + debugInfo.sequence +
            ' entries=' + debugInfo.segments +
            ' safety_delay=' + liveEdge.hiddenSegments +
            ' visible=' + liveEdge.visibleSegments
        );
        res.setHeader(
            'X-Therand-Vavoo-Live-Edge-Delay-Segments',
            String(liveEdge.hiddenSegments)
        );
        setPlaylistHeaders(res);
        res.send(rewrittenPlaylist);`,
  'logical HLS live-edge diagnostics'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched HLS live-edge safety delay: ' + target +
  ' (default 2 segments)'
);
