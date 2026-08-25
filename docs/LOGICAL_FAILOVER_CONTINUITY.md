# Logical failover continuity / Continuité du failover logique

## FR

Cette protection complète les garde-fous live existants (`playlist stall`, sonde média et rejet de `#EXT-X-ENDLIST`) pour trois pannes observées pendant une lecture Kodi déjà ouverte.

### 1. Discontinuité HLS persistante

Le proxy conserve désormais une file des discontinuités logiques créées par un changement de variante ou un reset de `MEDIA-SEQUENCE`.

Tant qu'un point de bascule est visible, `#EXT-X-DISCONTINUITY` est injecté devant le segment concerné. Lorsqu'il sort de la fenêtre HLS glissante, le proxy incrémente `#EXT-X-DISCONTINUITY-SEQUENCE` au lieu d'oublier l'événement.

Cela permet au lecteur de conserver l'historique de la timeline même après disparition du segment portant le marqueur.

### 2. Protection contre les requêtes concurrentes anciennes

Chaque échec/quarantaine d'une variante incrémente une génération runtime.

Une tentative capture cette génération avant son premier accès amont et la vérifie après les attentes asynchrones importantes. Si une autre requête a quarantiné la variante entre-temps, le résultat ancien est ignoré et ne peut plus appeler `markLogicalVariantSuccess()` ni supprimer la quarantaine.

Une tentative commencée alors que la variante était déjà quarantinée conserve le comportement de dernier recours existant : elle peut encore réhabiliter la variante si aucun nouvel échec n'arrive pendant sa tentative.

### 3. Watchdog de fenêtre live effondrée

Le proxy mémorise qu'une variante a déjà présenté une fenêtre saine d'au moins 3 segments.

Si une playlist fraîche de cette variante tombe ensuite à 1 ou 2 segments :

1. les caches URL/playlist et les états de progression/média sont purgés ;
2. une récupération amont forcée est effectuée ;
3. si la fenêtre revient à au moins 3 segments, la variante continue normalement ;
4. si elle reste à 1 ou 2 segments, la variante est mise en quarantaine et le reranking logique choisit la suivante.

Une variante qui n'a jamais été vue avec au moins 3 segments n'est pas rejetée par ce garde-fou, afin de ne pas casser une source dont la fenêtre normale serait volontairement courte.

## EN

This guard extends the existing live protections (`playlist stall`, media liveness probing and `#EXT-X-ENDLIST` rejection) for three failures observed while Kodi keeps the same logical player session open.

### 1. Persistent HLS discontinuity history

The proxy now keeps a queue of logical discontinuities created by a variant switch or a `MEDIA-SEQUENCE` reset.

While a switch point remains visible, `#EXT-X-DISCONTINUITY` is emitted before the affected segment. Once it slides out of the live window, `#EXT-X-DISCONTINUITY-SEQUENCE` is incremented instead of forgetting that discontinuity.

### 2. Stale in-flight request protection

Every variant failure/quarantine increments a runtime generation counter.

An attempt captures that generation before fetching upstream and checks it again after important asynchronous waits. If another request quarantined the variant meanwhile, the older result is ignored and cannot call `markLogicalVariantSuccess()` or clear the newer quarantine.

An attempt that deliberately starts while a variant is already quarantined keeps the existing last-resort recovery semantics, as long as no newer failure happens during that attempt.

### 3. Collapsed live-window watchdog

After a variant has been observed with a healthy window of at least 3 segments, a fresh 1–2 segment playlist is treated as suspicious.

The proxy invalidates runtime caches and forces one clean upstream refresh. Recovery to at least 3 segments is accepted. A second 1–2 segment result is quarantined and the logical candidate reranking continues instead of forwarding the miniature playlist to Kodi.
