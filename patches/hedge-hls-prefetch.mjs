import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node hedge-hls-prefetch.mjs <index.js>');
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
  `const HLS_PREFETCH_SEGMENT_COUNT = readIntegerEnvironment(
    'VAVOO_HLS_PREFETCH_SEGMENT_COUNT',
    2,
    0,
    10
);`,
  `const HLS_PREFETCH_SEGMENT_COUNT = readIntegerEnvironment(
    'VAVOO_HLS_PREFETCH_SEGMENT_COUNT',
    2,
    0,
    10
);
const HLS_PREFETCH_HEDGE_DELAY_MS = readIntegerEnvironment(
    'VAVOO_HLS_PREFETCH_HEDGE_DELAY_MS',
    1500,
    0,
    10000
);`,
  'HLS prefetch hedge environment setting insertion'
);

replaceExactlyOnce(
  'async function proxyUpstreamUrl(req, res, upstreamUrl) {',
  `async function awaitSharedHlsAssetWithHedge(
    req,
    inflight,
    upstreamUrl,
    clientSignal,
    upstreamLabel,
    connId
) {
    if (HLS_PREFETCH_HEDGE_DELAY_MS === 0) {
        return inflight;
    }

    let timer;
    const first = await Promise.race([
        inflight.then(
            (result) => ({ settled: true, result }),
            (error) => ({ settled: true, error })
        ),
        new Promise((resolve) => {
            timer = setTimeout(
                () => resolve({ settled: false }),
                HLS_PREFETCH_HEDGE_DELAY_MS
            );
        })
    ]);
    clearTimeout(timer);

    if (first.settled) {
        if (first.error) {
            throw first.error;
        }
        return first.result;
    }

    console.log(
        '[' + connId + '] hls asset hedge started "' + upstreamLabel +
        '" delay=' + HLS_PREFETCH_HEDGE_DELAY_MS + 'ms'
    );

    const hedgeController = new AbortController();
    const hedgeSignal = AbortSignal.any([
        clientSignal,
        hedgeController.signal
    ]);
    const hedgePromise = fetchHlsResourceWithRetries(
        req,
        upstreamUrl,
        hedgeSignal,
        upstreamLabel
    );

    try {
        const winner = await Promise.any([
            inflight.then((result) => ({ source: 'prefetch', result })),
            hedgePromise.then((result) => ({ source: 'hedge', result }))
        ]);

        if (winner.source === 'hedge') {
            console.log(
                '[' + connId + '] hls asset hedge won "' +
                upstreamLabel + '"'
            );
        }

        return winner.result;
    } catch (error) {
        if (error instanceof AggregateError && error.errors.length > 0) {
            throw error.errors[0];
        }
        throw error;
    } finally {
        hedgeController.abort();
    }
}

async function proxyUpstreamUrl(req, res, upstreamUrl) {`,
  'HLS prefetch hedge helper insertion'
);

replaceExactlyOnce(
  `        let result;
        const inflight = hlsAssetInflight.get(cacheKey);
        if (inflight) {
            console.log(
                '[' + connId + '] hls asset awaiting prefetch "' +
                upstreamLabel + '"'
            );
            try {
                result = await inflight;
            } catch (error) {
                console.log(
                    '[vavoo] hls asset prefetch fallback "' +
                    upstreamLabel + '" error="' + error.message + '"'
                );
            }
        }

        if (!result) {`,
  `        let result;
        const inflight = hlsAssetInflight.get(cacheKey);
        if (inflight) {
            console.log(
                '[' + connId + '] hls asset awaiting prefetch "' +
                upstreamLabel + '"'
            );
            try {
                result = await awaitSharedHlsAssetWithHedge(
                    req,
                    inflight,
                    upstreamUrl,
                    controller.signal,
                    upstreamLabel,
                    connId
                );
            } catch (error) {
                console.log(
                    '[vavoo] hls asset prefetch fallback "' +
                    upstreamLabel + '" error="' + error.message + '"'
                );
            }
        }

        if (!result) {`,
  'shared HLS prefetch wait hedge replacement'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched delayed hedge for stalled HLS prefetch requests: ' + target
);
