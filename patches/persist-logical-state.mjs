import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node persist-logical-state.mjs <index.js>');
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
  "const crypto = require('node:crypto');",
  `const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');`,
  'persistent logical-state imports'
);

replaceExactlyOnce(
  'const logicalVariantState = new Map();',
  `const logicalVariantState = new Map();

const LOGICAL_STATE_FILE = String(
    process.env.VAVOO_LOGICAL_STATE_FILE || '/data/logical-state.json'
).trim();
const logicalPersistentRestoredGroups = new Set();
const logicalPersistentState = (() => {
    const empty = { version: 1, groups: {} };

    if (!LOGICAL_STATE_FILE) {
        return empty;
    }

    try {
        if (!fs.existsSync(LOGICAL_STATE_FILE)) {
            return empty;
        }

        const parsed = JSON.parse(
            fs.readFileSync(LOGICAL_STATE_FILE, 'utf8')
        );
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            !parsed.groups ||
            typeof parsed.groups !== 'object'
        ) {
            throw new Error('invalid persistent-state structure');
        }

        return {
            version: 1,
            groups: parsed.groups
        };
    } catch (error) {
        console.log(
            '[vavoo] logical state load skipped file="' +
            LOGICAL_STATE_FILE + '" error="' + String(
                error && error.message ? error.message : error
            ) + '"'
        );
        return empty;
    }
})();

function findLogicalPersistedVariant(group, variantId, variantName) {
    if (variantId) {
        const byId = group.variants.find(
            (variant) => variant.id === variantId
        );
        if (byId) {
            return byId;
        }
    }

    if (variantName) {
        return group.variants.find(
            (variant) => variant.name === variantName
        ) || null;
    }

    return null;
}

function writeLogicalPersistentState() {
    if (!LOGICAL_STATE_FILE) {
        return;
    }

    const directory = path.dirname(LOGICAL_STATE_FILE);
    const temporary =
        LOGICAL_STATE_FILE + '.tmp-' + process.pid + '-' + Date.now();

    try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
            temporary,
            JSON.stringify(logicalPersistentState, null, 2) + '\\n',
            { encoding: 'utf8', mode: 0o600 }
        );
        fs.renameSync(temporary, LOGICAL_STATE_FILE);
    } catch (error) {
        try {
            fs.unlinkSync(temporary);
        } catch (cleanupError) {
        }

        console.log(
            '[vavoo] logical state save failed file="' +
            LOGICAL_STATE_FILE + '" error="' + String(
                error && error.message ? error.message : error
            ) + '"'
        );
    }
}

function persistLogicalVariantState(group, state) {
    if (!LOGICAL_STATE_FILE) {
        return;
    }

    const now = Date.now();
    const active = group.variants.find(
        (variant) => variant.id === state.activeVariantId
    );
    const quarantines = [];

    for (const [variantId, until] of state.quarantinedUntil.entries()) {
        if (!Number.isFinite(until) || until <= now) {
            continue;
        }

        const variant = group.variants.find(
            (candidate) => candidate.id === variantId
        );
        if (!variant) {
            continue;
        }

        quarantines.push({
            variantId: variant.id,
            variantName: variant.name,
            until
        });
    }

    logicalPersistentState.groups[group.id] = {
        groupName: group.name,
        country: group.country,
        activeVariantId: active ? active.id : null,
        activeVariantName: active ? active.name : null,
        quarantines,
        updatedAt: now
    };
    writeLogicalPersistentState();
}

function restoreLogicalVariantState(group, state) {
    if (
        !LOGICAL_STATE_FILE ||
        logicalPersistentRestoredGroups.has(group.id)
    ) {
        return;
    }

    logicalPersistentRestoredGroups.add(group.id);
    const saved = logicalPersistentState.groups[group.id];
    if (!saved || typeof saved !== 'object') {
        return;
    }

    const now = Date.now();
    let restoredQuarantines = 0;

    for (const entry of Array.isArray(saved.quarantines)
        ? saved.quarantines
        : []) {
        if (!entry || !Number.isFinite(entry.until) || entry.until <= now) {
            continue;
        }

        const variant = findLogicalPersistedVariant(
            group,
            entry.variantId,
            entry.variantName
        );
        if (!variant) {
            continue;
        }

        state.quarantinedUntil.set(variant.id, entry.until);
        restoredQuarantines += 1;
    }

    const active = findLogicalPersistedVariant(
        group,
        saved.activeVariantId,
        saved.activeVariantName
    );
    if (active && !state.quarantinedUntil.has(active.id)) {
        state.activeVariantId = active.id;
    }

    console.log(
        '[vavoo] logical state restored "' + group.name +
        '" active="' + (active && state.activeVariantId === active.id
            ? active.name
            : 'none') +
        '" quarantined=' + restoredQuarantines
    );
}
`,
  'persistent logical-state helpers'
);

replaceExactlyOnce(
  `    const validIds = new Set(group.variants.map((variant) => variant.id));`,
  `    restoreLogicalVariantState(group, state);

    const validIds = new Set(group.variants.map((variant) => variant.id));`,
  'persistent logical-state restore hook'
);

replaceExactlyOnce(
  `    if (state.activeVariantId === variant.id) {
        state.activeVariantId = null;
    }

    console.log(`,
  `    if (state.activeVariantId === variant.id) {
        state.activeVariantId = null;
    }

    persistLogicalVariantState(group, state);

    console.log(`,
  'persistent logical-state failure hook'
);

replaceExactlyOnce(
  `function markLogicalVariantSuccess(group, variant) {
    const state = getLogicalVariantState(group);
    const previousId = state.activeVariantId;`,
  `function markLogicalVariantSuccess(group, variant) {
    const state = getLogicalVariantState(group);
    const previousId = state.activeVariantId;
    const wasQuarantined = state.quarantinedUntil.has(variant.id);`,
  'persistent logical-state success prelude'
);

replaceExactlyOnce(
  `    state.quarantinedUntil.delete(variant.id);
    state.staleSinceByVariant.delete(variant.id);
    state.activeVariantId = variant.id;

    if (previousId !== variant.id) {`,
  `    state.quarantinedUntil.delete(variant.id);
    state.staleSinceByVariant.delete(variant.id);
    state.activeVariantId = variant.id;

    if (previousId !== variant.id || wasQuarantined) {
        persistLogicalVariantState(group, state);
    }

    if (previousId !== variant.id) {`,
  'persistent logical-state success hook'
);

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched persistent logical variant state: ' + target
);
