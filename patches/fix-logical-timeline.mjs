import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node fix-logical-timeline.mjs <index.js>');
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
  `        state = {
            variantId: null,
            offset: 0,
            lastLogicalEnd: null,
            switchSequence: null
        };`,
  `        state = {
            variantId: null,
            offset: 0,
            lastLogicalEnd: null,
            lastSourceFirst: null,
            switchSequence: null
        };`,
  'logical timeline state extension'
);

replaceExactlyOnce(
  `    if (state.variantId === null) {
        state.variantId = variant.id;
    } else if (state.variantId !== variant.id) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.variantId = variant.id;
        state.switchSequence = logicalFirst;
        switched = true;
    } else if (
        Number.isFinite(state.lastLogicalEnd) &&
        logicalFirst + segmentCount - 1 <= state.lastLogicalEnd
    ) {
        logicalFirst = state.lastLogicalEnd + 1;
        state.offset = logicalFirst - sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    }`,
  `    if (state.variantId === null) {
        state.variantId = variant.id;
        state.lastSourceFirst = sourceFirst;
    } else if (state.variantId !== variant.id) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.variantId = variant.id;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else if (
        Number.isFinite(state.lastSourceFirst) &&
        sourceFirst < state.lastSourceFirst
    ) {
        logicalFirst = Number.isFinite(state.lastLogicalEnd)
            ? state.lastLogicalEnd + 1
            : logicalFirst;
        state.offset = logicalFirst - sourceFirst;
        state.lastSourceFirst = sourceFirst;
        state.switchSequence = logicalFirst;
        switched = true;
    } else {
        state.lastSourceFirst = sourceFirst;
    }`,
  'logical timeline reset detection fix'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched logical timeline duplicate-playlist handling: ' + target
);
