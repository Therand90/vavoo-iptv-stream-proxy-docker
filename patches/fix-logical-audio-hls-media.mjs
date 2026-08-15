import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node fix-logical-audio-hls-media.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

const search = "!/(?:^|,)TYPE=AUDIO(?:,|$)/i.test(line)";
const replacement = "!/(?:^|[:,])TYPE=AUDIO(?:,|$)/i.test(line)";
const occurrences = source.split(search).length - 1;

if (occurrences !== 1) {
  throw new Error(
    'HLS audio-media parser fix: expected exactly one match, found ' + occurrences
  );
}

source = source.replace(search, replacement);

if (!source.includes("(?:^|[:,])TYPE=AUDIO")) {
  throw new Error('HLS audio-media parser fix verification failed');
}

writeFileSync(target, source, 'utf8');
console.log('[therand] patched HLS EXT-X-MEDIA audio-language matching: ' + target);
