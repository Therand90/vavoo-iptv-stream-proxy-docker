# Logical live `EXT-X-ENDLIST` handling

## English

Logical VAVOO groups represent live TV channels. A media playlist for such a group must therefore remain open-ended. If an upstream variant starts returning `#EXT-X-ENDLIST`, forwarding that marker to Kodi makes the player consume the remaining buffered segments and then stop normally at EOF even though the logical channel itself should still be live.

The proxy now treats `#EXT-X-ENDLIST` as a failure of that individual upstream variant rather than as the end of the logical channel:

1. the signed stream-URL cache and playlist cache for the variant are invalidated;
2. playlist-progress and media-health runtime state for that variant are cleared;
3. the ordinary logical-variant quarantine is applied;
4. the same logical request continues through the existing post-failure reranking so another eligible variant can be selected;
5. the terminating playlist is never sent to Kodi.

A diagnostic line records the event and the playlist shape:

```text
[vavoo] logical live playlist ended "CHANNEL" variant="VARIANT" sequence=N entries=N
```

This rule is deliberately limited to logical live-TV groups. It does not globally strip `#EXT-X-ENDLIST` from arbitrary HLS content.

## Français

Les groupes VAVOO logiques représentent des chaînes TV en direct. Leur playlist média doit donc rester ouverte. Lorsqu'une variante amont commence à renvoyer `#EXT-X-ENDLIST`, transmettre ce marqueur à Kodi lui fait consommer les derniers segments en tampon puis terminer normalement sur un EOF alors que la chaîne logique, elle, devrait toujours être en direct.

Le proxy considère maintenant `#EXT-X-ENDLIST` comme l'échec de cette variante amont individuelle, et non comme la fin de la chaîne logique :

1. le cache de l'URL signée et le cache de playlist de la variante sont invalidés ;
2. l'état runtime de progression de playlist et de disponibilité média de cette variante est effacé ;
3. la quarantaine logique ordinaire est appliquée ;
4. la même requête logique poursuit le reclassement post-échec déjà existant afin de sélectionner une autre variante éligible ;
5. la playlist terminée n'est jamais envoyée à Kodi.

Un log explicite enregistre l'événement et la forme de la playlist :

```text
[vavoo] logical live playlist ended "CHANNEL" variant="VARIANT" sequence=N entries=N
```

Cette règle est volontairement limitée aux groupes TV live logiques. Elle ne supprime pas globalement `#EXT-X-ENDLIST` de n'importe quel contenu HLS.
