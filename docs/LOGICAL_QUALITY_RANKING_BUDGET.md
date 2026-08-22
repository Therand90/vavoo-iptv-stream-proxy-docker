# Bounded logical quality ranking

## English

Logical channel startup used to wait for every eligible variant quality probe to finish before returning an ordered candidate list. A single dead variant could therefore keep `Promise.all()` pending through repeated upstream playlist timeouts even when other variants had already produced valid media measurements.

The proxy now gives the parallel quality-ranking phase a fixed 12-second startup budget.

- All eligible quality probes still start in parallel.
- Measurements completed within the budget are ranked normally by audio-language policy and real-media quality score.
- Healthy completed measurements are tried first.
- Variants whose probe is still pending when the budget expires are not marked failed and are not quarantined; they remain eligible immediately after the completed measurements, in their existing logical order.
- A completed quality probe that returned an error is placed after pending variants but before already quarantined variants.
- Outstanding probes are allowed to finish in the background and can populate the normal in-memory quality cache for later requests.
- Existing sticky-active behavior is unchanged. The budget is relevant when no healthy active variant exists or when a restored active variant requires its one-shot post-restart validation.

When the budget expires with unfinished probes, the proxy logs:

```text
[vavoo] logical quality ranking budget reached "CHANNEL" completed=N pending=N budget_ms=12000 pending_variants="..."
```

This prevents one unreachable source from turning a bounded startup ranking operation into a minute-long Kodi startup failure.

## Français

Auparavant, le démarrage d'une chaîne logique attendait la fin de toutes les sondes qualité des variantes éligibles avant de retourner une liste ordonnée. Une seule variante morte pouvait donc maintenir le `Promise.all()` en attente pendant plusieurs timeouts de playlist amont, même lorsque d'autres variantes avaient déjà fourni des mesures média valides.

Le proxy limite maintenant la phase de classement qualité parallèle à un budget fixe de 12 secondes au démarrage.

- Toutes les sondes qualité éligibles démarrent toujours en parallèle.
- Les mesures terminées dans le budget sont classées normalement selon la politique de langue audio puis le score de qualité média réelle.
- Les mesures valides terminées sont essayées en premier.
- Les variantes dont la sonde est encore en cours à l'expiration du budget ne sont ni déclarées en échec ni mises en quarantaine ; elles restent immédiatement éligibles après les variantes déjà mesurées, dans leur ordre logique existant.
- Une sonde qualité terminée avec une erreur passe après les variantes encore en attente mais avant les variantes déjà en quarantaine.
- Les sondes encore en cours peuvent terminer en arrière-plan et alimenter le cache qualité en mémoire pour les requêtes suivantes.
- Le comportement sticky d'une variante active saine ne change pas. Ce budget intervient lorsqu'aucune variante active saine n'existe ou lorsqu'une variante restaurée doit subir sa validation unique après redémarrage.

Lorsque le budget expire avec des sondes inachevées, le proxy écrit :

```text
[vavoo] logical quality ranking budget reached "CHANNEL" completed=N pending=N budget_ms=12000 pending_variants="..."
```

L'objectif est qu'une seule source amont inaccessible ne transforme plus un classement de démarrage borné en échec Kodi après plus d'une minute d'attente.
