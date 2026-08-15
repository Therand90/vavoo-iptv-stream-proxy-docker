import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node filter-logical-audio-language.mjs <index.js>');
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

const languageHelpers = String.raw`
const LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED =
    String(process.env.VAVOO_AUDIO_LANGUAGE_FILTER_ENABLED || 'true')
        .toLowerCase() !== 'false';

function normalizeLogicalAudioLanguage(value) {
    const original = String(value || '').trim().toLowerCase();
    if (!original) {
        return '';
    }

    const base = original.split(/[-_]/, 1)[0];
    if (['fr', 'fra', 'fre'].includes(base)) {
        return 'fra';
    }
    if (['en', 'eng'].includes(base)) {
        return 'eng';
    }
    if (['und', 'mul', 'zxx', 'mis', 'qaa'].includes(base)) {
        return '';
    }
    return base;
}

function parseLogicalAudioLanguageSet(value, fallback) {
    const output = new Set();
    for (const raw of String(value || fallback || '').split(',')) {
        const normalized = normalizeLogicalAudioLanguage(raw);
        if (normalized) {
            output.add(normalized);
        }
    }
    return output;
}

const LOGICAL_AUDIO_PREFERRED_LANGUAGES = parseLogicalAudioLanguageSet(
    process.env.VAVOO_AUDIO_PREFERRED_LANGUAGES,
    'fra,fre,fr'
);
const LOGICAL_AUDIO_BLOCKED_LANGUAGES = parseLogicalAudioLanguageSet(
    process.env.VAVOO_AUDIO_BLOCKED_LANGUAGES,
    'eng,en'
);

function mergeLogicalAudioLanguages(...groups) {
    const output = new Set();
    for (const group of groups) {
        for (const value of group || []) {
            const normalized = normalizeLogicalAudioLanguage(value);
            if (normalized) {
                output.add(normalized);
            }
        }
    }
    return [...output].sort();
}

function classifyLogicalAudioLanguages(languages) {
    const values = new Set(mergeLogicalAudioLanguages(languages));

    if (!LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
        return 'disabled';
    }
    if ([...values].some((value) => LOGICAL_AUDIO_PREFERRED_LANGUAGES.has(value))) {
        return 'preferred';
    }
    if ([...values].some((value) => LOGICAL_AUDIO_BLOCKED_LANGUAGES.has(value))) {
        return 'blocked';
    }
    if (!values.size) {
        return 'unknown';
    }
    return 'other';
}

function getLogicalAudioLanguageRank(quality) {
    const classification = String(quality && quality.audioLanguageClass || 'unknown');
    if (classification === 'preferred') {
        return 3;
    }
    if (classification === 'other') {
        return 2;
    }
    if (classification === 'unknown' || classification === 'disabled') {
        return 1;
    }
    return 0;
}

function isLogicalAudioBlocked(quality) {
    return LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED &&
        String(quality && quality.audioLanguageClass || 'unknown') === 'blocked';
}

function getAudioLanguagesFromHlsPlaylist(playlist) {
    const languages = [];
    for (const rawLine of String(playlist || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!/^#EXT-X-MEDIA:/i.test(line) || !/(?:^|,)TYPE=AUDIO(?:,|$)/i.test(line)) {
            continue;
        }
        const match = line.match(/(?:^|,)LANGUAGE=(?:"([^"]+)"|([^,\s]+))/i);
        if (match) {
            languages.push(match[1] || match[2] || '');
        }
    }
    return mergeLogicalAudioLanguages(languages);
}

function getTransportStreamPacketPayload(packet) {
    if (!packet || packet.length !== 188 || packet[0] !== 0x47 || (packet[1] & 0x80)) {
        return null;
    }
    const adaptationFieldControl = (packet[3] >> 4) & 0x03;
    if (adaptationFieldControl !== 1 && adaptationFieldControl !== 3) {
        return null;
    }
    let offset = 4;
    if (adaptationFieldControl === 3) {
        if (offset >= packet.length) {
            return null;
        }
        offset += 1 + packet[offset];
    }
    if (offset >= packet.length) {
        return null;
    }
    return packet.subarray(offset);
}

function collectTransportStreamPsiSections(buffer, pid, tableId) {
    const start = findMpegTsStart(buffer);
    if (start < 0) {
        return [];
    }

    let pending = Buffer.alloc(0);
    const sections = [];

    function consumePending() {
        while (pending.length >= 3) {
            if (pending[0] === 0xff) {
                pending = Buffer.alloc(0);
                return;
            }
            const sectionLength = ((pending[1] & 0x0f) << 8) | pending[2];
            if (sectionLength < 4 || sectionLength > 4093) {
                pending = pending.subarray(1);
                continue;
            }
            const totalLength = 3 + sectionLength;
            if (pending.length < totalLength) {
                return;
            }
            const section = pending.subarray(0, totalLength);
            pending = pending.subarray(totalLength);
            if (section[0] === tableId) {
                sections.push(Buffer.from(section));
            }
        }
    }

    for (let position = start; position + 187 < buffer.length; position += 188) {
        const packet = buffer.subarray(position, position + 188);
        if (packet[0] !== 0x47 || (packet[1] & 0x80)) {
            continue;
        }
        const packetPid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (packetPid !== pid) {
            continue;
        }
        const payload = getTransportStreamPacketPayload(packet);
        if (!payload || !payload.length) {
            continue;
        }
        const payloadUnitStart = Boolean(packet[1] & 0x40);

        if (payloadUnitStart) {
            const pointer = payload[0];
            if (1 + pointer > payload.length) {
                pending = Buffer.alloc(0);
                continue;
            }
            if (pending.length && pointer > 0) {
                pending = Buffer.concat([
                    pending,
                    payload.subarray(1, 1 + pointer)
                ]);
                consumePending();
            }
            pending = Buffer.from(payload.subarray(1 + pointer));
            consumePending();
        } else if (pending.length) {
            pending = Buffer.concat([pending, payload]);
            consumePending();
        }
    }

    return sections;
}

function getTransportStreamPmtPids(buffer) {
    const output = new Set();
    for (const section of collectTransportStreamPsiSections(buffer, 0, 0x00)) {
        const end = Math.max(8, section.length - 4);
        for (let offset = 8; offset + 3 < end; offset += 4) {
            const programNumber = (section[offset] << 8) | section[offset + 1];
            if (!programNumber) {
                continue;
            }
            output.add(((section[offset + 2] & 0x1f) << 8) | section[offset + 3]);
        }
    }
    return [...output];
}

function descriptorLooksAudio(descriptors) {
    for (let offset = 0; offset + 1 < descriptors.length;) {
        const tag = descriptors[offset];
        const length = descriptors[offset + 1];
        const end = offset + 2 + length;
        if (end > descriptors.length) {
            break;
        }
        if ([0x0a, 0x6a, 0x7a, 0x7b, 0x7c].includes(tag)) {
            return true;
        }
        offset = end;
    }
    return false;
}

function getIso639LanguagesFromDescriptors(descriptors) {
    const output = [];
    for (let offset = 0; offset + 1 < descriptors.length;) {
        const tag = descriptors[offset];
        const length = descriptors[offset + 1];
        const begin = offset + 2;
        const end = begin + length;
        if (end > descriptors.length) {
            break;
        }
        if (tag === 0x0a) {
            for (let position = begin; position + 3 < end; position += 4) {
                output.push(String.fromCharCode(
                    descriptors[position],
                    descriptors[position + 1],
                    descriptors[position + 2]
                ));
            }
        }
        offset = end;
    }
    return mergeLogicalAudioLanguages(output);
}

function getAudioLanguagesFromTransportStream(buffer) {
    const languages = [];
    const audioStreamTypes = new Set([0x03, 0x04, 0x0f, 0x11, 0x81, 0x87]);

    for (const pmtPid of getTransportStreamPmtPids(buffer)) {
        for (const section of collectTransportStreamPsiSections(buffer, pmtPid, 0x02)) {
            if (section.length < 16) {
                continue;
            }
            const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
            let offset = 12 + programInfoLength;
            const end = Math.max(offset, section.length - 4);

            while (offset + 4 < end) {
                const streamType = section[offset];
                const esInfoLength = ((section[offset + 3] & 0x0f) << 8) | section[offset + 4];
                const descriptorStart = offset + 5;
                const descriptorEnd = descriptorStart + esInfoLength;
                if (descriptorEnd > end) {
                    break;
                }
                const descriptors = section.subarray(descriptorStart, descriptorEnd);
                if (audioStreamTypes.has(streamType) || descriptorLooksAudio(descriptors)) {
                    languages.push(...getIso639LanguagesFromDescriptors(descriptors));
                }
                offset = descriptorEnd;
            }
        }
    }

    return mergeLogicalAudioLanguages(languages);
}
`;

replaceExactlyOnce(
  '\nasync function probeLogicalVariantQuality(req, group, variant) {',
  '\n' + languageHelpers + '\nasync function probeLogicalVariantQuality(req, group, variant) {',
  'logical audio language helpers insertion'
);

replaceExactlyOnce(
  `            samples.push({
                ...segment,
                body: asset.body,
                fingerprint: fingerprintTransportStream(asset.body)
            });`,
  `            samples.push({
                ...segment,
                body: asset.body,
                fingerprint: fingerprintTransportStream(asset.body),
                audioLanguages: getAudioLanguagesFromTransportStream(asset.body)
            });`,
  'quality sample audio-language extraction'
);

replaceExactlyOnce(
  '        let loopSuspect = false;',
  `        const audioLanguages = mergeLogicalAudioLanguages(
            getAudioLanguagesFromHlsPlaylist(upstream.playlist),
            ...samples.map((sample) => sample.audioLanguages || [])
        );
        const audioLanguageClass = classifyLogicalAudioLanguages(audioLanguages);

        let loopSuspect = false;`,
  'quality audio-language aggregation'
);

replaceExactlyOnce(
  `            bitrateKbps: Number.isFinite(bitrateKbps) ? Math.round(bitrateKbps) : null,
            loopSuspect,`,
  `            bitrateKbps: Number.isFinite(bitrateKbps) ? Math.round(bitrateKbps) : null,
            audioLanguages,
            audioLanguageClass,
            loopSuspect,`,
  'quality result audio-language metadata'
);

replaceExactlyOnce(
  `            bitrateKbps: null,
            loopSuspect: false,`,
  `            bitrateKbps: null,
            audioLanguages: [],
            audioLanguageClass: 'unknown',
            loopSuspect: false,`,
  'failed quality result audio-language metadata'
);

replaceExactlyOnce(
  `            ' bitrate_kbps=' + (result.bitrateKbps || 'unknown') +
            ' score=' + result.score +`,
  `            ' bitrate_kbps=' + (result.bitrateKbps || 'unknown') +
            ' audio_languages=' + (result.audioLanguages.length ? result.audioLanguages.join(',') : 'unknown') +
            ' audio_class=' + result.audioLanguageClass +
            ' score=' + result.score +`,
  'quality probe audio-language logging'
);

const rankingSearch = String.raw`async function getRankedLogicalVariants(req, group) {
    const state = getLogicalVariantState(group);
    const ordered = getOrderedLogicalVariants(group);
    const active = ordered.find(
        (variant) => variant.id === state.activeVariantId &&
            !state.quarantinedUntil.has(variant.id)
    );

    if (active || !LOGICAL_QUALITY_RANKING_ENABLED || group.variants.length < 2) {
        return ordered;
    }

    const healthy = ordered.filter(
        (variant) => !state.quarantinedUntil.has(variant.id)
    );
    const quarantined = ordered.filter(
        (variant) => state.quarantinedUntil.has(variant.id)
    );

    const measured = await Promise.all(
        healthy.map(async (variant, index) => ({
            variant,
            index,
            quality: await probeLogicalVariantQuality(req, group, variant)
        }))
    );

    measured.sort((left, right) => {
        const scoreDifference = right.quality.score - left.quality.score;
        return scoreDifference || left.index - right.index;
    });

    console.log(
        '[vavoo] logical quality ranking "' + group.name + '" ' +
        measured.map((entry) => entry.variant.name + '=' + entry.quality.score).join(' > ')
    );

    return [
        ...measured.map((entry) => entry.variant),
        ...quarantined
    ];
}`;

const rankingReplacement = String.raw`async function getRankedLogicalVariants(req, group) {
    const state = getLogicalVariantState(group);
    const ordered = getOrderedLogicalVariants(group);
    const active = ordered.find(
        (variant) => variant.id === state.activeVariantId &&
            !state.quarantinedUntil.has(variant.id)
    );

    if (active) {
        if (!LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
            return ordered;
        }
        const activeQuality = getLogicalQualityCached(group, active);
        if (activeQuality && !isLogicalAudioBlocked(activeQuality)) {
            return ordered;
        }
        if (activeQuality && isLogicalAudioBlocked(activeQuality)) {
            console.log(
                '[vavoo] logical audio language rejects active variant "' + group.name +
                '" variant="' + active.name +
                '" languages=' + (activeQuality.audioLanguages || []).join(',')
            );
        }
    }

    if (
        !LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED &&
        (!LOGICAL_QUALITY_RANKING_ENABLED || group.variants.length < 2)
    ) {
        return ordered;
    }

    const healthy = ordered.filter(
        (variant) => !state.quarantinedUntil.has(variant.id)
    );
    const quarantined = ordered.filter(
        (variant) => state.quarantinedUntil.has(variant.id)
    );

    const measured = await Promise.all(
        healthy.map(async (variant, index) => ({
            variant,
            index,
            quality: await probeLogicalVariantQuality(req, group, variant)
        }))
    );

    measured.sort((left, right) => {
        if (LOGICAL_AUDIO_LANGUAGE_FILTER_ENABLED) {
            const languageDifference =
                getLogicalAudioLanguageRank(right.quality) -
                getLogicalAudioLanguageRank(left.quality);
            if (languageDifference) {
                return languageDifference;
            }
        }
        if (LOGICAL_QUALITY_RANKING_ENABLED) {
            const scoreDifference = right.quality.score - left.quality.score;
            if (scoreDifference) {
                return scoreDifference;
            }
        }
        return left.index - right.index;
    });

    const allowedMeasured = measured.filter(
        (entry) => !isLogicalAudioBlocked(entry.quality)
    );
    const allowedQuarantined = quarantined.filter((variant) => {
        const quality = getLogicalQualityCached(group, variant);
        return !quality || !isLogicalAudioBlocked(quality);
    });

    console.log(
        '[vavoo] logical quality ranking "' + group.name + '" ' +
        measured.map((entry) =>
            entry.variant.name + '=' + entry.quality.score +
            '[' + entry.quality.audioLanguageClass + ':' +
            ((entry.quality.audioLanguages || []).join(',') || 'unknown') + ']'
        ).join(' > ')
    );

    if (!allowedMeasured.length && !allowedQuarantined.length) {
        console.log(
            '[vavoo] logical audio language blocked every variant "' +
            group.name + '"'
        );
    }

    return [
        ...allowedMeasured.map((entry) => entry.variant),
        ...allowedQuarantined
    ];
}`;

replaceExactlyOnce(
  rankingSearch,
  rankingReplacement,
  'logical audio language ranking policy'
);

replaceExactlyOnce(
  `                score: quality.score,
                loop_suspect: quality.loopSuspect,
                measured_at: Math.floor(quality.measuredAt / 1000)`,
  `                score: quality.score,
                audio_languages: quality.audioLanguages || [],
                audio_language_class: quality.audioLanguageClass || 'unknown',
                audio_language_allowed: !isLogicalAudioBlocked(quality),
                loop_suspect: quality.loopSuspect,
                measured_at: Math.floor(quality.measuredAt / 1000)`,
  'logical health audio-language metadata insertion'
);

function normalizeForSelfTest(value) {
  const base = String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
  if (['fr', 'fra', 'fre'].includes(base)) return 'fra';
  if (['en', 'eng'].includes(base)) return 'eng';
  return base;
}

if (
  normalizeForSelfTest('fr-FR') !== 'fra' ||
  normalizeForSelfTest('fre') !== 'fra' ||
  normalizeForSelfTest('en-US') !== 'eng'
) {
  throw new Error('logical audio language normalization self-test failed');
}

if (
  !source.includes('logical audio language blocked every variant') ||
  !source.includes('audio_language_class') ||
  !source.includes('getAudioLanguagesFromTransportStream')
) {
  throw new Error('logical audio language patch verification failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched preferred/blocked audio-language policy for logical VAVOO variants: ' + target
);
