# Cold-start and logical-media resilience

## English

Three startup failure modes are handled explicitly by the Docker wrapper.

### Catalog cold start

The VAVOO catalog can take roughly twenty seconds to rebuild from the upstream API. The proxy now:

- starts one catalog warmup as soon as the HTTP server is listening;
- deduplicates concurrent catalog loads so Kodi and the remote Playlist Manager wait on the same upstream request instead of starting duplicate catalog downloads;
- stores the last successful catalog snapshot in `/data/channels-cache.json` on the existing persistent Docker volume;
- restores snapshots up to 48 hours old immediately after a restart;
- serves a stale-but-recent snapshot immediately while refreshing the catalog in the background when the normal six-hour catalog TTL has expired.

This snapshot is only a startup accelerator. A successful upstream refresh always replaces it and remains authoritative.

### Restored active variant validation

The persisted logical state keeps the last successful active variant across container recreations, but the quality/audio measurements are intentionally kept only in memory. A restored active variant therefore has no fresh quality evidence immediately after restart.

The proxy now marks such a restored active variant for one-shot validation. On the first logical selection after restore, the normal real-media ranking runs across the currently eligible variants before stickiness is re-enabled. Once one variant is successfully selected, the validation flag is cleared and ordinary sticky behavior resumes.

This is deliberately not a periodic re-ranking mechanism. When the in-memory quality cache expires later during established playback, that expiry alone still does not replace a healthy active variant.

### Playlist reachable, media unreachable

A logical variant is no longer considered healthy only because its `.m3u8` playlist returns HTTP 200. Before selecting a fresh logical variant, the proxy probes up to the first two media segments Kodi is about to consume. The probe has a short 4.5-second budget and accepts the variant as soon as one segment is reachable.

A successful probe is cached for 30 seconds to avoid repeating work on every playlist refresh. When both candidate segments are unavailable, the proxy invalidates the variant stream/playlist caches, applies the normal temporary variant quarantine, and continues to the next logical variant in the same request. This is intended to turn cases such as “playlist works but every `.ts` times out” into an internal VAVOO failover before Kodi reaches its own startup timeout.

The probe reuses the existing HLS asset cache and shared in-flight fetches, so a successful startup probe also primes media that Kodi may request immediately afterwards.

---

## Français

Trois causes d’échec au démarrage sont maintenant gérées explicitement par le wrapper Docker.

### Démarrage à froid du catalogue

La reconstruction du catalogue VAVOO depuis l’API amont peut prendre une vingtaine de secondes. Le proxy :

- lance désormais un préchauffage du catalogue dès que le serveur HTTP écoute ;
- déduplique les chargements simultanés afin que Kodi et le Playlist Manager distant attendent la même requête amont au lieu de lancer plusieurs téléchargements du catalogue ;
- enregistre le dernier catalogue valide dans `/data/channels-cache.json` sur le volume Docker persistant déjà utilisé ;
- restaure immédiatement un snapshot âgé de moins de 48 h après un redémarrage ;
- lorsqu’un snapshot récent a dépassé le TTL normal de six heures, le sert immédiatement puis actualise le catalogue en arrière-plan.

Le snapshot sert uniquement d’accélérateur de démarrage. Dès qu’un rafraîchissement amont réussit, ce nouveau catalogue remplace le snapshot et redevient la référence.

### Validation de la variante active restaurée

L’état logique persistant conserve la dernière variante active qui a fonctionné après une recréation du conteneur, mais les mesures qualité/langue restent volontairement uniquement en mémoire. Une variante active restaurée ne dispose donc d’aucune mesure fraîche juste après le redémarrage.

Le proxy marque maintenant cette variante pour une validation unique. Lors de la première sélection logique après restauration, le classement normal basé sur les médias réels est exécuté sur les variantes encore éligibles avant de réactiver le comportement sticky. Dès qu’une variante est sélectionnée avec succès, le marqueur de validation est effacé et la sélection redevient stable.

Ce mécanisme n’est volontairement pas un reclassement périodique. Lorsque le cache qualité en mémoire expire plus tard pendant une lecture établie, cette expiration seule ne remplace toujours pas une variante active saine.

### Playlist joignable mais média inaccessible

Une variante logique n’est plus considérée saine uniquement parce que sa playlist `.m3u8` répond HTTP 200. Avant de sélectionner une variante fraîche, le proxy sonde jusqu’aux deux premiers segments média que Kodi va devoir consommer. La sonde dispose d’un budget court de 4,5 s et valide la variante dès qu’un seul segment est réellement joignable.

Une réussite est mémorisée pendant 30 s afin de ne pas refaire le travail à chaque rafraîchissement de playlist. Si les deux segments candidats sont inaccessibles, le proxy invalide les caches URL/playlist de la variante, applique la quarantaine temporaire ordinaire et tente immédiatement la variante logique suivante dans la même requête. L’objectif est de transformer le cas « playlist OK mais tous les `.ts` expirent » en failover VAVOO interne avant que Kodi n’atteigne son propre délai d’abandon au démarrage.

La sonde réutilise le cache HLS et les téléchargements déjà en vol. Lorsqu’elle réussit au démarrage, elle précharge donc également un média que Kodi peut demander juste après.
