# Logical failover reranking

## English

A logical VAVOO channel can have several technical variants (`.b`, `.c`, `.s`, `FHD`, `4K`, etc.). Quality probes run in parallel and the initial ranking is bounded so one slow source cannot block Kodi indefinitely.

A second issue can happen after that first ranking: while Kodi is waiting for the selected variant's media-liveness check, quality probes for other variants may finish. If the first selected variant then fails, continuing through the original frozen candidate list can ignore those newly available measurements and pick a worse or stale source.

The proxy now reranks the remaining candidates after each runtime variant failure. This reranking is intentionally cache-only: it uses measurements that have already completed and never starts another 12-second ranking budget during the same request.

The post-failure order is:

1. healthy variants with a completed successful quality measurement, ordered by the normal language/quality policy;
2. healthy variants whose quality probe is still pending or absent;
3. healthy variants whose quality probe completed with an error;
4. already quarantined variants as a last resort.

Variants already attempted during the current logical request are never retried in the same request.

A persisted/restored active variant whose current quality measurement completed with an error is also no longer treated as automatically healthy/sticky. The proxy logs `logical active quality error revalidation` and allows the normal selection logic to choose another candidate.

Useful diagnostics:

```text
[vavoo] logical candidate reranking "CHANNEL" attempted=N next="VARIANT"
[vavoo] logical active quality error revalidation "CHANNEL" variant="VARIANT" error="..."
```

This complements the bounded initial quality ranking: the first ranking stays limited in time, while later failures can immediately benefit from probes that finished in the background.

---

## Français

Une chaîne logique VAVOO peut regrouper plusieurs variantes techniques (`.b`, `.c`, `.s`, `FHD`, `4K`, etc.). Les sondes qualité partent en parallèle et le classement initial est borné afin qu'une seule source lente ne bloque pas Kodi indéfiniment.

Un second problème peut apparaître après ce premier classement : pendant que Kodi attend le test de disponibilité média de la variante choisie, les sondes qualité d'autres variantes peuvent se terminer. Si la première variante échoue ensuite, continuer à parcourir la liste figée calculée auparavant peut ignorer ces nouvelles mesures et sélectionner une source moins bonne ou périmée.

Le proxy reclasse désormais les variantes restantes après chaque échec d'une variante pendant la même requête. Ce reclassement utilise uniquement le cache : il exploite les mesures déjà terminées et ne relance jamais un nouveau budget de 12 secondes pendant cette requête.

L'ordre après un échec devient :

1. variantes saines avec une mesure qualité terminée et réussie, classées selon la politique normale langue/qualité ;
2. variantes saines dont la mesure est encore absente ou en cours ;
3. variantes saines dont la mesure s'est terminée en erreur ;
4. variantes déjà en quarantaine en dernier recours.

Une variante déjà essayée pendant la requête logique courante n'est jamais retentée dans cette même requête.

Une variante active persistée/restaurée dont la mesure qualité courante s'est terminée en erreur n'est également plus considérée automatiquement saine/sticky. Le proxy écrit `logical active quality error revalidation` et laisse la sélection normale choisir une autre candidate.

Logs utiles :

```text
[vavoo] logical candidate reranking "CHANNEL" attempted=N next="VARIANT"
[vavoo] logical active quality error revalidation "CHANNEL" variant="VARIANT" error="..."
```

Ce mécanisme complète le classement initial borné : le premier classement reste limité dans le temps, tandis qu'un échec ultérieur peut profiter immédiatement des sondes terminées en arrière-plan.
