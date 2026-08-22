# HLS safety buffer and range-aware cache

## English

The local HLS buffer has two complementary jobs: keep a few segments behind the upstream live edge, and make those prefetched segments actually reusable by Kodi.

### Range-aware cache serving

Kodi may request MPEG-TS assets with a single HTTP `Range` header such as `bytes=0-`. The proxy already prefetched and cached full `.ts` assets, but range requests previously bypassed that cache and could trigger a second upstream fetch.

The proxy now serves supported single byte ranges directly from the cached full asset:

- `bytes=0-`
- `bytes=START-END`
- `bytes=-SUFFIX_LENGTH`

A valid cached range is returned as HTTP `206 Partial Content` with `Accept-Ranges`, `Content-Range`, and `Content-Length`. Unsatisfiable single ranges return HTTP 416. Unsupported forms such as multipart ranges continue through the normal upstream path.

Only full upstream responses are stored in the asset cache; partial upstream responses are never promoted into the full-asset cache.

### Drain the hidden safety window when a playlist becomes stale

During normal live playback, `VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS` hides the newest prefetched segments from Kodi. This creates a local safety margin.

When the proxy has to serve a stale-but-last-valid playlist while refreshing or failing over, keeping those segments hidden defeats the purpose of that margin. The stale playlist is therefore exposed with a temporary safety delay of zero. The already-prefetched tail becomes visible to Kodi while the proxy continues its upstream recovery/failover work.

Once a fresh playlist is available again, the configured live-edge delay is automatically restored.

This does not create media that the upstream never produced. It only makes already-downloaded reserve segments usable during a transient playlist outage.

---

## Français

Le tampon HLS local a désormais deux rôles complémentaires : conserver quelques segments de retard par rapport au direct amont et permettre à Kodi de réutiliser réellement les segments déjà préchargés.

### Cache compatible avec les requêtes Range

Kodi peut demander les segments MPEG-TS avec un en-tête HTTP `Range`, par exemple `bytes=0-`. Le proxy préchargeait déjà le `.ts` complet, mais ces requêtes contournaient auparavant le cache et pouvaient provoquer un second téléchargement depuis VAVOO.

Le proxy sert maintenant directement depuis le segment complet en cache les plages simples suivantes :

- `bytes=0-`
- `bytes=DEBUT-FIN`
- `bytes=-TAILLE_SUFFIXE`

Une plage valide est renvoyée en HTTP `206 Partial Content` avec `Accept-Ranges`, `Content-Range` et `Content-Length`. Une plage simple impossible renvoie HTTP 416. Les formes non prises en charge, notamment les plages multiples, continuent de passer par le chemin amont normal.

Seules les réponses amont complètes sont enregistrées comme segments complets dans le cache ; une réponse partielle amont n'est jamais stockée à leur place.

### Vidage de la réserve cachée lorsque la playlist devient stale

En lecture normale, `VAVOO_HLS_LIVE_EDGE_DELAY_SEGMENTS` masque à Kodi les derniers segments déjà préchargés afin de constituer une marge locale.

Lorsque le proxy doit servir temporairement la dernière playlist valide pendant un rafraîchissement ou un failover, conserver cette réserve masquée annule son intérêt. Pour une playlist stale, le délai de sécurité est donc temporairement ramené à zéro : les derniers segments déjà présents deviennent visibles pendant que le proxy continue ses tentatives de récupération ou de bascule.

Dès qu'une playlist fraîche revient, le délai configuré est automatiquement réappliqué.

Ce mécanisme ne corrige pas un flux dont les images sont déjà saccadées à la source. Il permet uniquement de consommer la réserve déjà téléchargée lors d'une interruption transitoire de la playlist amont.
