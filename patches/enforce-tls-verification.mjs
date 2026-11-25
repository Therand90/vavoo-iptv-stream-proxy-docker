import fs from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node enforce-tls-verification.mjs <index.js>');
const source = fs.readFileSync(path, 'utf8');
const disabled = "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';";
const enabled = "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';";

if (source.split(disabled).length !== 2) {
    throw new Error('Unexpected upstream TLS configuration; review before building.');
}
const patched = source.replace(disabled, enabled);
fs.writeFileSync(path, patched);
console.log('TLS certificate verification enforced');
