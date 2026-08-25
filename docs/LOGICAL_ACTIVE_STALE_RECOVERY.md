# Logical active stale recovery / Récupération stale de la variante active

## English

A logical channel can temporarily stop refreshing its HLS playlist even while the media segments already exposed to Kodi are still valid. Treating the first short playlist timeout as a hard source failure makes failover too aggressive and can move playback away from an otherwise healthy source.

The active-variant stale grace therefore has two layers:

- `VAVOO_ACTIVE_STALE_GRACE_SECONDS` remains the minimum configured grace (8 seconds by default).
- When the active source still owns an undrained live-edge reserve, the proxy derives a longer safe grace from the real HLS segment duration and the number of delayed segments.

The calculated grace keeps enough time in reserve for the normal fast handoff (`VAVOO_PLAYLIST_FAST_FALLBACK_MS`) and is capped at 45 seconds. If the live-edge reserve has already been drained, the proxy falls back to the configured minimum grace instead of pretending that hidden buffer still exists.

Fresh playlist recovery clears the stale timer immediately. If refreshes keep failing past the computed grace, normal quarantine and fast logical failover continue unchanged.

Diagnostic log example:

```text
[vavoo] logical active stale grace "CHANNEL" variant="SOURCE" age_ms=... grace_ms=... reserve_segments=... segment_ms=... draining=false
```

## Français

Une chaîne logique peut cesser temporairement de rafraîchir sa playlist HLS alors que les segments média déjà disponibles pour Kodi restent parfaitement valides. Considérer un court timeout de playlist comme une panne franche rend le failover trop agressif et peut éjecter une source qui fonctionne encore correctement.

La grâce `stale` de la variante active fonctionne donc désormais sur deux niveaux :

- `VAVOO_ACTIVE_STALE_GRACE_SECONDS` reste la grâce minimale configurée (8 secondes par défaut).
- Si la source active possède encore une réserve `live-edge` qui n'a pas été vidée, le proxy calcule une grâce sûre plus longue à partir de la durée réelle des segments HLS et du nombre de segments retardés.

La grâce calculée conserve une marge suffisante pour le basculement rapide normal (`VAVOO_PLAYLIST_FAST_FALLBACK_MS`) et reste plafonnée à 45 secondes. Si la réserve `live-edge` a déjà été vidée, le proxy revient à la grâce minimale configurée au lieu de supposer qu'un buffer caché existe encore.

Dès qu'une playlist fraîche revient, le compteur `stale` est remis à zéro. Si les rafraîchissements continuent d'échouer au-delà de la grâce calculée, la quarantaine et le failover logique rapide restent inchangés.

Exemple de diagnostic :

```text
[vavoo] logical active stale grace "CHAINE" variant="SOURCE" age_ms=... grace_ms=... reserve_segments=... segment_ms=... draining=false
```
