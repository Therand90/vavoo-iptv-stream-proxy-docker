import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node sign-hls-proxy-urls.mjs <index.js>');
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
  `function getProxiedUpstreamUrl(req, upstreamUrl) {
    return \`${'${req.protocol}'}://${'${req.headers.host}'}/hls-proxy?url=${'${encodeURIComponent(upstreamUrl)}'}\`;
}`,
  `const HLS_PROXY_SECRET = (() => {
    const configured = String(
        process.env.VAVOO_HLS_PROXY_SECRET || ''
    ).trim();

    if (configured.length >= 32) {
        return configured;
    }

    if (configured) {
        console.log(
            '[vavoo] ignored VAVOO_HLS_PROXY_SECRET shorter than 32 characters'
        );
    }

    return crypto.randomBytes(32).toString('hex');
})();

function getHlsProxySignature(upstreamUrl) {
    return crypto
        .createHmac('sha256', HLS_PROXY_SECRET)
        .update(String(upstreamUrl))
        .digest('hex');
}

function isValidHlsProxySignature(upstreamUrl, signature) {
    const expected = Buffer.from(getHlsProxySignature(upstreamUrl), 'hex');
    const received = Buffer.from(String(signature || ''), 'hex');

    return received.length === expected.length &&
        crypto.timingSafeEqual(received, expected);
}

function getProxiedUpstreamUrl(req, upstreamUrl) {
    const signature = getHlsProxySignature(upstreamUrl);
    return req.protocol + '://' + req.headers.host +
        '/hls-proxy?url=' + encodeURIComponent(upstreamUrl) +
        '&sig=' + encodeURIComponent(signature);
}`,
  'signed HLS proxy URL helpers insertion'
);

replaceExactlyOnce(
  `app.get('/hls-proxy', async function (req, res) {
    const upstreamUrl = req.query.url;
    const connId = \`${'${req.socket.remoteAddress}'}\`;

    if (!upstreamUrl) {
        console.log(\`[${'${connId}'}] hls proxy error: missing url\`);
        res.status(400).send('missing url');
        return;
    }

    try {`,
  `app.get('/hls-proxy', async function (req, res) {
    const upstreamUrl = req.query.url;
    const signature = req.query.sig;
    const connId = \`${'${req.socket.remoteAddress}'}\`;

    if (!upstreamUrl) {
        console.log(\`[${'${connId}'}] hls proxy error: missing url\`);
        res.status(400).send('missing url');
        return;
    }

    if (!isValidHlsProxySignature(upstreamUrl, signature)) {
        console.log(\`[${'${connId}'}] hls proxy rejected: invalid signature\`);
        res.status(403).send('invalid hls proxy signature');
        return;
    }

    try {`,
  'HLS proxy signature validation insertion'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched signed HLS proxy URLs: ' + target
);
