import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node rank-logical-variants-v2.mjs <index.js>');
  process.exit(1);
}

let source = readFileSync(target, 'utf8');

function block(lines) {
  return lines.join('\n');
}

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
  'const logicalTimelineState = new Map();',
  block([
    'const logicalTimelineState = new Map();',
    'const logicalVariantQuality = new Map();',
    '',
    'const LOGICAL_QUALITY_RANKING_ENABLED =',
    "    String(process.env.VAVOO_QUALITY_RANKING_ENABLED || 'true')",
    "        .toLowerCase() !== 'false';",
    '',
    'const LOGICAL_QUALITY_CACHE_SECONDS = (() => {',
    '    const configured = Number.parseInt(',
    "        process.env.VAVOO_QUALITY_CACHE_SECONDS || '1800',",
    '        10',
    '    );',
    '    return Number.isFinite(configured) && configured >= 60',
    '        ? Math.min(configured, 86400)',
    '        : 1800;',
    '})();',
    '',
    'const LOGICAL_QUALITY_PROBE_SEGMENTS = 2;'
  ]),
  'logical quality constants insertion'
);

const qualityHelpers = String.raw`
function getLogicalQualityKey(group, variant) {
    return group.id + '|' + variant.id;
}

function getLogicalQualityCached(group, variant) {
    const key = getLogicalQualityKey(group, variant);
    const value = logicalVariantQuality.get(key);

    if (!value) {
        return null;
    }

    if (
        Date.now() - value.measuredAt >
        LOGICAL_QUALITY_CACHE_SECONDS * 1000
    ) {
        logicalVariantQuality.delete(key);
        return null;
    }

    return value;
}

function getLogicalQualityNameHint(name) {
    const value = String(name || '').toUpperCase();

    if (/\b(?:4K|UHD)\b/.test(value)) {
        return 4;
    }
    if (/\b(?:FULL\s*HD|FHD)\b/.test(value)) {
        return 3;
    }
    if (/\bHD\b/.test(value)) {
        return 2;
    }
    if (/\bSD\b/.test(value)) {
        return 0;
    }
    return 1;
}

function getLogicalQualityResolutionScore(width, height, nameHint) {
    if (Number.isFinite(width) && Number.isFinite(height)) {
        const pixels = width * height;

        if (pixels >= 7000000 || (width >= 3800 && height >= 2000)) {
            return 50;
        }
        if (pixels >= 1800000 || (width >= 1900 && height >= 1000)) {
            return 40;
        }
        if (pixels >= 850000 || (width >= 1260 && height >= 700)) {
            return 30;
        }
        if (pixels >= 350000) {
            return 20;
        }
        return 10;
    }

    return [18, 24, 30, 38, 48][nameHint] || 18;
}

function getLogicalQualityFrameRateScore(fps) {
    if (!Number.isFinite(fps) || fps <= 0) {
        return 8;
    }
    if (fps >= 49) {
        return 25;
    }
    if (fps >= 29) {
        return 18;
    }
    if (fps >= 23) {
        return 12;
    }
    return 6;
}

function getLogicalQualityBitrateScore(kbps) {
    if (!Number.isFinite(kbps) || kbps <= 0) {
        return 6;
    }
    if (kbps >= 12000) {
        return 25;
    }
    if (kbps >= 8000) {
        return 22;
    }
    if (kbps >= 5000) {
        return 18;
    }
    if (kbps >= 3000) {
        return 14;
    }
    if (kbps >= 1500) {
        return 9;
    }
    return 5;
}

function scoreLogicalVariantQuality(result, variant) {
    const nameHint = getLogicalQualityNameHint(variant.name);
    let score =
        getLogicalQualityResolutionScore(result.width, result.height, nameHint) +
        getLogicalQualityFrameRateScore(result.fps) +
        getLogicalQualityBitrateScore(result.bitrateKbps);

    score += nameHint * 0.01;

    if (result.stale) {
        score -= 500;
    }
    if (result.loopSuspect) {
        score -= 1000;
    }

    return Number(score.toFixed(2));
}

function getQualityProbeSegments(streamUrl, playlist) {
    const lines = String(playlist || '').split(/\r?\n/);
    let mediaSequence = null;
    let duration = null;
    const segments = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            const parsed = Number.parseInt(line.split(':', 2)[1], 10);
            if (Number.isFinite(parsed)) {
                mediaSequence = parsed;
            }
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            const parsed = Number.parseFloat(
                line.slice('#EXTINF:'.length).split(',', 1)[0]
            );
            duration = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
            continue;
        }

        if (!line || line.startsWith('#')) {
            continue;
        }

        try {
            const parsed = new URL(line, streamUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                duration = null;
                continue;
            }
            if (!/\.(?:ts|m4s|mp4)$/i.test(parsed.pathname)) {
                duration = null;
                continue;
            }
            segments.push({
                url: parsed.toString(),
                duration
            });
        } catch (error) {
        }

        duration = null;
    }

    const tail = segments.slice(-LOGICAL_QUALITY_PROBE_SEGMENTS);
    if (Number.isFinite(mediaSequence)) {
        const first = mediaSequence + Math.max(0, segments.length - tail.length);
        tail.forEach((segment, index) => {
            segment.sequence = first + index;
        });
    }
    return tail;
}

class H264BitReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.bit = 0;
    }

    readBit() {
        if (this.bit >= this.buffer.length * 8) {
            throw new Error('SPS bitstream exhausted');
        }
        const byte = this.buffer[Math.floor(this.bit / 8)];
        const shift = 7 - (this.bit % 8);
        this.bit += 1;
        return (byte >> shift) & 1;
    }

    readBits(count) {
        let value = 0;
        for (let index = 0; index < count; index += 1) {
            value = value * 2 + this.readBit();
        }
        return value;
    }

    readUE() {
        let zeros = 0;
        while (this.readBit() === 0) {
            zeros += 1;
            if (zeros > 31) {
                throw new Error('invalid Exp-Golomb value');
            }
        }
        if (zeros === 0) {
            return 0;
        }
        return (2 ** zeros - 1) + this.readBits(zeros);
    }

    readSE() {
        const value = this.readUE();
        return value % 2 === 0
            ? -(value / 2)
            : (value + 1) / 2;
    }
}

function removeH264EmulationPrevention(buffer) {
    const output = [];
    let zeros = 0;

    for (const byte of buffer) {
        if (zeros >= 2 && byte === 0x03) {
            zeros = 0;
            continue;
        }
        output.push(byte);
        zeros = byte === 0x00 ? zeros + 1 : 0;
    }

    return Buffer.from(output);
}

function skipH264ScalingList(reader, size) {
    let lastScale = 8;
    let nextScale = 8;

    for (let index = 0; index < size; index += 1) {
        if (nextScale !== 0) {
            const deltaScale = reader.readSE();
            nextScale = (lastScale + deltaScale + 256) % 256;
        }
        lastScale = nextScale === 0 ? lastScale : nextScale;
    }
}

function parseH264VuiFrameRate(reader) {
    if (reader.readBit()) {
        const aspectRatioIdc = reader.readBits(8);
        if (aspectRatioIdc === 255) {
            reader.readBits(16);
            reader.readBits(16);
        }
    }

    if (reader.readBit()) {
        reader.readBit();
    }

    if (reader.readBit()) {
        reader.readBits(3);
        reader.readBit();
        if (reader.readBit()) {
            reader.readBits(8);
            reader.readBits(8);
            reader.readBits(8);
        }
    }

    if (reader.readBit()) {
        reader.readUE();
        reader.readUE();
    }

    if (!reader.readBit()) {
        return null;
    }

    const numUnitsInTick = reader.readBits(32);
    const timeScale = reader.readBits(32);
    reader.readBit();

    if (!numUnitsInTick || !timeScale) {
        return null;
    }

    const fps = timeScale / (2 * numUnitsInTick);
    return Number.isFinite(fps) && fps > 0 && fps < 240
        ? fps
        : null;
}

function parseH264Sps(nal) {
    try {
        if (!nal || nal.length < 5 || (nal[0] & 0x1f) !== 7) {
            return null;
        }

        const rbsp = removeH264EmulationPrevention(nal.subarray(1));
        const reader = new H264BitReader(rbsp);
        const profileIdc = reader.readBits(8);
        reader.readBits(8);
        reader.readBits(8);
        reader.readUE();

        let chromaFormatIdc = 1;
        let separateColourPlaneFlag = 0;

        if ([100,110,122,244,44,83,86,118,128,138,139,134,135].includes(profileIdc)) {
            chromaFormatIdc = reader.readUE();
            if (chromaFormatIdc === 3) {
                separateColourPlaneFlag = reader.readBit();
            }
            reader.readUE();
            reader.readUE();
            reader.readBit();

            if (reader.readBit()) {
                const listCount = chromaFormatIdc !== 3 ? 8 : 12;
                for (let index = 0; index < listCount; index += 1) {
                    if (reader.readBit()) {
                        skipH264ScalingList(reader, index < 6 ? 16 : 64);
                    }
                }
            }
        }

        reader.readUE();
        const picOrderCntType = reader.readUE();
        if (picOrderCntType === 0) {
            reader.readUE();
        } else if (picOrderCntType === 1) {
            reader.readBit();
            reader.readSE();
            reader.readSE();
            const count = reader.readUE();
            for (let index = 0; index < count; index += 1) {
                reader.readSE();
            }
        }

        reader.readUE();
        reader.readBit();

        const picWidthInMbsMinus1 = reader.readUE();
        const picHeightInMapUnitsMinus1 = reader.readUE();
        const frameMbsOnlyFlag = reader.readBit();
        if (!frameMbsOnlyFlag) {
            reader.readBit();
        }
        reader.readBit();

        let cropLeft = 0;
        let cropRight = 0;
        let cropTop = 0;
        let cropBottom = 0;

        if (reader.readBit()) {
            cropLeft = reader.readUE();
            cropRight = reader.readUE();
            cropTop = reader.readUE();
            cropBottom = reader.readUE();
        }

        const chromaArrayType = separateColourPlaneFlag ? 0 : chromaFormatIdc;
        let cropUnitX = 1;
        let cropUnitY = 2 - frameMbsOnlyFlag;

        if (chromaArrayType !== 0) {
            const subWidthC = chromaArrayType === 3 ? 1 : 2;
            const subHeightC = chromaArrayType === 1 ? 2 : 1;
            cropUnitX = subWidthC;
            cropUnitY = subHeightC * (2 - frameMbsOnlyFlag);
        }

        const width = (picWidthInMbsMinus1 + 1) * 16 - cropUnitX * (cropLeft + cropRight);
        const height = (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - cropUnitY * (cropTop + cropBottom);

        let fps = null;
        if (reader.readBit()) {
            fps = parseH264VuiFrameRate(reader);
        }

        return { width, height, fps };
    } catch (error) {
        return null;
    }
}

function getH264MetricsFromTransportStream(buffer) {
    const payloads = extractPesPayloads(buffer);

    for (const payload of payloads.values()) {
        const starts = findAnnexBStarts(payload);

        for (let index = 0; index < starts.length; index += 1) {
            const current = starts[index];
            const next = starts[index + 1];
            const begin = current.index + current.size;
            const end = next ? next.index : payload.length;

            if (end <= begin) {
                continue;
            }

            const nal = payload.subarray(begin, end);
            if ((nal[0] & 0x1f) !== 7) {
                continue;
            }

            const parsed = parseH264Sps(nal);
            if (parsed) {
                return parsed;
            }
        }
    }

    return null;
}

async function probeLogicalVariantQuality(req, group, variant) {
    const cached = getLogicalQualityCached(group, variant);
    if (cached) {
        return cached;
    }

    const measuredAt = Date.now();

    try {
        const upstream = await fetchChannelPlaylist(req, variant);
        const segments = getQualityProbeSegments(upstream.streamUrl, upstream.playlist);

        if (!segments.length) {
            throw new Error('no media segment available for quality probe');
        }

        const samples = [];
        for (const segment of segments) {
            const asset = await fetchLogicalLoopAsset(req, segment.url);
            if (!asset || asset.kind !== 'asset' || !asset.body) {
                continue;
            }
            samples.push({
                ...segment,
                body: asset.body,
                fingerprint: fingerprintTransportStream(asset.body)
            });
        }

        if (!samples.length) {
            throw new Error('media assets unavailable for quality probe');
        }

        let totalBytes = 0;
        let totalDuration = 0;
        for (const sample of samples) {
            if (Number.isFinite(sample.duration) && sample.duration > 0) {
                totalBytes += sample.body.length;
                totalDuration += sample.duration;
            }
        }

        const bitrateKbps = totalDuration > 0
            ? totalBytes * 8 / totalDuration / 1000
            : null;

        let media = null;
        for (const sample of samples) {
            media = getH264MetricsFromTransportStream(sample.body);
            if (media) {
                break;
            }
        }

        let loopSuspect = false;
        let loopSimilarity = 0;
        let loopCommonNals = 0;

        if (samples.length >= 2 && samples[0].fingerprint && samples[1].fingerprint) {
            const compared = compareLogicalFingerprints(samples[0].fingerprint, samples[1].fingerprint);
            loopSimilarity = compared.similarity;
            loopCommonNals = compared.common;
            loopSuspect =
                compared.similarity >= LOGICAL_LOOP_SIMILARITY_THRESHOLD &&
                compared.common >= LOGICAL_LOOP_MIN_COMMON_NALS;
        }

        const result = {
            measuredAt,
            width: media ? media.width : null,
            height: media ? media.height : null,
            fps: media && Number.isFinite(media.fps) ? Number(media.fps.toFixed(3)) : null,
            bitrateKbps: Number.isFinite(bitrateKbps) ? Math.round(bitrateKbps) : null,
            loopSuspect,
            loopSimilarity: Number(loopSimilarity.toFixed(3)),
            loopCommonNals,
            stale: Boolean(upstream.stale),
            error: null
        };
        result.score = scoreLogicalVariantQuality(result, variant);
        logicalVariantQuality.set(getLogicalQualityKey(group, variant), result);

        console.log(
            '[vavoo] logical quality probe "' + group.name +
            '" variant="' + variant.name +
            '" resolution=' + (result.width && result.height ? result.width + 'x' + result.height : 'unknown') +
            ' fps=' + (result.fps || 'unknown') +
            ' bitrate_kbps=' + (result.bitrateKbps || 'unknown') +
            ' score=' + result.score +
            ' loop_suspect=' + result.loopSuspect
        );

        return result;
    } catch (error) {
        const result = {
            measuredAt,
            width: null,
            height: null,
            fps: null,
            bitrateKbps: null,
            loopSuspect: false,
            loopSimilarity: 0,
            loopCommonNals: 0,
            stale: false,
            error: String(error && error.message ? error.message : error),
            score: -10000
        };
        logicalVariantQuality.set(getLogicalQualityKey(group, variant), result);
        console.log(
            '[vavoo] logical quality probe failed "' + group.name +
            '" variant="' + variant.name +
            '" error="' + result.error + '"'
        );
        return result;
    }
}

async function getRankedLogicalVariants(req, group) {
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
}
`;

replaceExactlyOnce(
  '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  '\n' + qualityHelpers + '\nasync function fetchLogicalChannelPlaylist(req, group) {',
  'logical quality helpers insertion'
);

replaceExactlyOnce(
  '    const variants = getOrderedLogicalVariants(group);',
  '    const variants = await getRankedLogicalVariants(req, group);',
  'logical quality ranking activation'
);

replaceExactlyOnce(
  block([
    '        return {',
    '            name: variant.name,',
    '            active: Boolean(active && active.id === variant.id),',
    '            quarantined: until > now,',
    '            quarantined_until: until > now ? Math.floor(until / 1000) : null',
    '        };'
  ]),
  block([
    '        const quality = getLogicalQualityCached(group, variant);',
    '        return {',
    '            name: variant.name,',
    '            active: Boolean(active && active.id === variant.id),',
    '            quarantined: until > now,',
    '            quarantined_until: until > now ? Math.floor(until / 1000) : null,',
    '            quality: quality ? {',
    '                width: quality.width,',
    '                height: quality.height,',
    '                fps: quality.fps,',
    '                bitrate_kbps: quality.bitrateKbps,',
    '                score: quality.score,',
    '                loop_suspect: quality.loopSuspect,',
    '                measured_at: Math.floor(quality.measuredAt / 1000)',
    '            } : null',
    '        };'
  ]),
  'logical health quality metadata insertion'
);

const cleanFhd = 40 + 25 + 22 + 0.03;
const lowBitrate4k = 50 + 12 + 14 + 0.04;
const loopingFhd = cleanFhd - 1000;

if (!(cleanFhd > lowBitrate4k && loopingFhd < 0)) {
  throw new Error('logical quality score self-test failed');
}

writeFileSync(target, source, 'utf8');
console.log(
  '[therand] patched real-media quality ranking for logical VAVOO variants: ' +
  target
);
