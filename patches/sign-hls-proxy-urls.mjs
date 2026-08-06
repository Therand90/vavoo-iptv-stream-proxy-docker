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

function isBlockedHlsProxyHostname(hostname) {
    const value = String(hostname || '')
        .toLowerCase()
        .replace(/^\\[|\\]$/g, '');

    if (
        value === 'localhost' ||
        value.endsWith('.localhost') ||
        value.endsWith('.local') ||
        value.endsWith('.internal') ||
        value === '::1' ||
        value.startsWith('fc') ||
        value.startsWith('fd') ||
        value.startsWith('fe8') ||
        value.startsWith('fe9') ||
        value.startsWith('fea') ||
        value.startsWith('feb')
    ) {
        return true;
    }

    const match = value.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
    if (!match) {
        return false;
    }

    const octets = match.slice(1).map(Number);
    if (octets.some((part) => part < 0 || part > 255)) {
        return true;
    }

    return octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        octets[0] === 0;
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

    try {
        const parsedUrl = new URL(upstreamUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            console.log(\`[${'${connId}'}] hls proxy error "${'${upstreamUrl}'}": unsupported protocol\`);
            res.status(400).send('unsupported upstream protocol');
            return;
        }`,
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

    try {
        const parsedUrl = new URL(upstreamUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            console.log(\`[${'${connId}'}] hls proxy error "${'${upstreamUrl}'}": unsupported protocol\`);
            res.status(400).send('unsupported upstream protocol');
            return;
        }
        if (isBlockedHlsProxyHostname(parsedUrl.hostname)) {
            console.log(\`[${'${connId}'}] hls proxy rejected: blocked hostname\`);
            res.status(403).send('blocked upstream hostname');
            return;
        }`,
  'HLS proxy signature and local-target validation insertion'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched signed HLS proxy URLs and local-target blocking: ' + target
);
