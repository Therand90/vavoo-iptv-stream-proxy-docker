import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) throw new Error('Usage: node adapt-mediahub-v2.mjs <index.js>');
let source = readFileSync(target, 'utf8');

function replaceOnce(before, after) {
    if (source.split(before).length !== 2) {
        throw new Error('MediaHubMX v2 patch anchor mismatch: ' + before.slice(0, 100));
    }
    source = source.replace(before, () => after);
}

const start = source.indexOf('async function loadCatalogFromBase(baseUrl, signature) {');
const end = source.indexOf('\n}', start) + 2;
if (start < 0 || end < 2 || !source.slice(start, end).includes('/mediahubmx-catalog.json')) {
    throw new Error('Original catalog loader not found');
}
replaceOnce(source.slice(start, end), "async function loadCatalogFromBase(baseUrl, signature) {\n    const endpoint = new URL('/live/catalog/live/channels.json', baseUrl);\n    endpoint.searchParams.set('language', currentLanguage);\n    endpoint.searchParams.set('region', currentRegion);\n    const channels = [];\n    const seenCursors = new Set();\n    let cursor = null;\n\n    do {\n        if (cursor !== null) endpoint.searchParams.set('cursor', cursor);\n        const body = await requestLiveV2(endpoint, signature);\n\n        if (!Array.isArray(body?.items)) {\n            throw new Error('Invalid MediaHubMX v2 catalog');\n        }\n\n        for (const item of body.items) {\n            if (item?.type !== 'live' || typeof item.name !== 'string' ||\n                !item.name.trim() || typeof item.url !== 'string' ||\n                !Array.isArray(item.tags) || typeof item.tags[0] !== 'string') {\n                continue;\n            }\n\n            let reference;\n            try { reference = new URL(item.url); } catch { continue; }\n            if (reference.origin !== endpoint.origin ||\n                !reference.pathname.startsWith('/live/play/')) continue;\n\n            channels.push(mapCatalogItem({\n                name: item.name,\n                group: item.tags[0],\n                logo: item.images?.logo || '',\n                url: reference.href\n            }));\n        }\n\n        cursor = body.nextCursor == null ? null : String(body.nextCursor);\n        if (cursor !== null) {\n            if (!cursor || seenCursors.has(cursor)) {\n                throw new Error('Repeated MediaHubMX v2 catalog cursor');\n            }\n            seenCursors.add(cursor);\n        }\n    } while (cursor !== null);\n\n    if (!channels.length) throw new Error('Empty MediaHubMX v2 catalog');\n    return channels;\n}\n\nasync function requestLiveV2(url, signature) {\n    const response = await fetch(url, {\n        headers: getCatalogHeaders(signature),\n        signal: AbortSignal.timeout(30000),\n        redirect: 'error'\n    });\n\n    if (!response.ok) {\n        const error = new Error('MediaHubMX v2 HTTP ' + response.status);\n        error.statusCode = response.status;\n        throw error;\n    }\n    return response.json();\n}\n\n");
replaceOnce("async function resolveStreamUrl(channel) {\n    const signature = await getAddonSignature();", "async function resolveStreamUrl(channel) {\n    const signature = await getAddonSignature();\n    const reference = new URL(channel.url);\n\n    if (reference.pathname.startsWith('/live/play/')) {\n        if (!baseSites.some(site => new URL(site).origin === reference.origin)) {\n            throw new Error('MediaHubMX v2 reference origin not configured');\n        }\n\n        const endpoint = new URL('/live/resolve', reference.origin);\n        endpoint.searchParams.set('url', reference.href);\n        endpoint.searchParams.set('language', currentLanguage);\n        endpoint.searchParams.set('region', currentRegion);\n        const result = await requestLiveV2(endpoint, signature);\n\n        if (typeof result?.url !== 'string') {\n            throw new Error('Invalid MediaHubMX v2 resolution');\n        }\n\n        const resolved = new URL(result.url);\n        if (!['http:', 'https:'].includes(resolved.protocol)) {\n            throw new Error('Unsupported resolved media protocol');\n        }\n        return resolved.href;\n    }");
replaceOnce("logicalName = logicalName.replace(/\\s+\\.[bcs]\\s*$/i, '').trim();", "logicalName = logicalName.replace(/\\s+(?:\\.[bcs]|\\(\\d+\\))\\s*$/i, '').trim();");
replaceOnce("            } catch (error) {\n                console.log(\n                    '[vavoo] catalog load failed for '", "            } catch (error) {\n                if ([401, 403, 428, 429].includes(error.statusCode)) throw error;\n                console.log(\n                    '[vavoo] catalog load failed for '");

writeFileSync(target, source, 'utf8');
console.log('[therand] MediaHubMX v2 compatibility: catalog, resolver and logical names');
