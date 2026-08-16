[English](CONFIGURATION.md) | [Français](CONFIGURATION.fr.md)

# Référence de configuration

Copiez le fichier d’exemple avant de démarrer le service :

```bash
cp .env.example .env
docker compose up -d
```

## Réseau et catalogue

| Variable | Valeur par défaut | Rôle |
|---|---:|---|
| `VAVOO_BIND_ADDRESS` | `127.0.0.1` | Adresse de l’hôte utilisée pour publier le port Docker. Conservez la valeur par défaut sauf si un réseau privé de confiance doit y accéder directement. |
| `VAVOO_PORT` | `8899` | Port de l’hôte redirigé vers le port `8888` du conteneur. |
| `VAVOO_LANGUAGE` | `en` | Langue envoyée aux API amont. Ce réglage ne filtre pas la langue audio des flux. |
| `VAVOO_REGION` | `US` | Région envoyée aux API amont. `US` conserve généralement un catalogue large. |
| `VAVOO_URL_LIST` | `both` | Sélection des sources amont : `primary`, `fallback` ou `both`. |
| `VAVOO_CHANNELS_CACHE_TTL_SECONDS` | `21600` | Durée du cache du catalogue. Les valeurs inférieures à 300 secondes reviennent à la valeur par défaut. |

## Résilience de la lecture

| Variable | Valeur par défaut | Rôle |
|---|---:|---|
| `VAVOO_STREAM_URL_TTL_SECONDS` | `3000` | Durée de vie locale d’une URL de flux signée. Cinquante minutes permettent son renouvellement avant l’expiration horaire habituelle. |
| `VAVOO_PLAYLIST_CACHE_TTL_SECONDS` | `300` | Durée de conservation de la dernière playlist média valide utilisée pendant une panne amont temporaire. |
| `VAVOO_PLAYLIST_HEDGE_DELAY_MS` | `1000` | Délai avant de lancer une unique requête playlist de secours lorsqu’une requête primaire reste bloquée pendant une lecture déjà établie. |
| `VAVOO_PLAYLIST_FAST_FALLBACK_MS` | `3000` | Budget total accordé à une playlist fraîche lorsqu’une dernière playlist valide existe déjà. Au-delà, le proxy sert immédiatement la playlist en cache et invalide l’URL signée pour le prochain passage. Utilisez `0` pour restaurer l’ancien chemin de retry pour ce cas. |
| `VAVOO_HLS_ASSET_CACHE_TTL_SECONDS` | `45` | Durée du cache mémoire court des ressources média HLS téléchargées avec succès. |
| `VAVOO_HLS_ASSET_MAX_CACHE_BYTES` | `12582912` | Taille maximale d’une ressource média mise en cache, en octets. La valeur par défaut correspond à 12 Mio. |
| `VAVOO_HLS_PREFETCH_SEGMENT_COUNT` | `2` | Nombre de segments média les plus récents préchargés depuis chaque playlist renouvelée. Utilisez `0` pour désactiver le préchargement. |
| `VAVOO_HLS_PREFETCH_HEDGE_DELAY_MS` | `1500` | Délai avant de lancer une requête de secours lorsqu’un lecteur attend un segment dont le préchargement est encore bloqué. |
| `VAVOO_VARIANT_QUARANTINE_SECONDS` | `300` | Quarantaine temporaire appliquée à une variante après une erreur ordinaire ou une playlist périmée persistante. |
| `VAVOO_ACTIVE_STALE_GRACE_SECONDS` | `15` | Délai de grâce pendant lequel une variante logique déjà active reste sélectionnée lorsque seule sa playlist fraîche est momentanément indisponible. Utilisez `0` pour désactiver ce délai. |
| `VAVOO_LOOP_DETECTION_ENABLED` | `true` | Active la détection légère de boucle vidéo MPEG-TS/H.264. |
| `VAVOO_LOOP_SIMILARITY_THRESHOLD` | `0.70` | Similarité minimale utilisée par la détection de répétition vidéo. |
| `VAVOO_LOOP_MIN_COMMON_NALS` | `100` | Nombre minimal de NAL communs requis avant de considérer une répétition comme significative. |
| `VAVOO_LOOP_CONFIRMATIONS` | `2` | Nombre de détections consécutives nécessaires avant de mettre une variante en quarantaine. |
| `VAVOO_LOOP_HISTORY_SEGMENTS` | `8` | Nombre de segments historiques conservés pour rechercher une répétition. |
| `VAVOO_LOOP_QUARANTINE_SECONDS` | `1800` | Durée de quarantaine d’une variante lorsqu’une boucle vidéo est confirmée. |
| `VAVOO_QUALITY_RANKING_ENABLED` | `true` | Classe les variantes à partir de la résolution, du framerate, du débit et des signaux de boucle lorsqu’aucune variante active saine n’existe. Une expiration du cache de mesures ne déclenche pas à elle seule un nouveau classement d’une variante déjà active. |
| `VAVOO_QUALITY_CACHE_SECONDS` | `1800` | Durée de conservation des mesures qualité et langue audio d’une variante. |
| `VAVOO_HLS_PROXY_SECRET` | généré au démarrage | Secret persistant facultatif utilisé pour signer les URL internes `/hls-proxy`. Laissez-le vide pour un seul conteneur. Utilisez le même secret robuste sur chaque réplique lorsque plusieurs instances doivent accepter mutuellement leurs URL signées. |

Pendant une lecture établie, une playlist qui répond normalement avant `VAVOO_PLAYLIST_HEDGE_DELAY_MS` ne génère aucune requête supplémentaire. Si elle reste bloquée, une seule requête de secours est lancée. Lorsque ni la requête primaire ni son secours ne fournissent une playlist fraîche avant `VAVOO_PLAYLIST_FAST_FALLBACK_MS`, le proxy renvoie la dernière playlist valide en cache au lieu de laisser Kodi attendre le timeout historique de plusieurs dizaines de secondes. L’URL signée est alors invalidée afin que le passage suivant reparte sur une résolution fraîche.

Pour une chaîne logique déjà en cours de lecture, ce fallback temporairement périmé ne provoque pas immédiatement un changement de variante : `VAVOO_ACTIVE_STALE_GRACE_SECONDS` maintient la source active pendant une courte fenêtre. Une panne persistante au-delà de cette fenêtre conserve le comportement normal de quarantaine et de failover. La détection de boucle reste indépendante : une vraie boucle confirmée continue à mettre immédiatement la variante en quarantaine longue.

## Langue audio des variantes logiques

Le proxy réutilise les mêmes playlists et segments déjà téléchargés pour le classement qualité. Il inspecte d’abord les déclarations HLS `#EXT-X-MEDIA`, puis les descripteurs ISO-639 présents dans les tables PMT des segments MPEG-TS. Aucun téléchargement média supplémentaire n’est nécessaire pour cette détection lorsqu’un probe qualité est déjà effectué.

| Variable | Valeur par défaut | Rôle |
|---|---:|---|
| `VAVOO_AUDIO_LANGUAGE_FILTER_ENABLED` | `true` | Active la politique de préférence/blocage de langue audio. |
| `VAVOO_AUDIO_PREFERRED_LANGUAGES` | `fra,fre,fr` | Langues préférées. Les alias `fr`, `fra` et `fre` sont normalisés en français. |
| `VAVOO_AUDIO_BLOCKED_LANGUAGES` | `eng,en` | Langues bloquées lorsqu’aucune langue préférée n’est déclarée sur la variante. |

Avec les valeurs par défaut :

- une variante déclarant du français est prioritaire ;
- une variante déclarant de l’anglais sans français est exclue du failover ;
- une variante dont la langue est inconnue reste utilisable en secours afin de ne pas perdre un flux simplement mal étiqueté ;
- une variante active saine ne change pas uniquement parce qu’une autre obtient une meilleure qualité technique ou parce que les mesures qualité en cache viennent d’expirer.

L’endpoint `/channel-groups` expose les langues détectées et la classe retenue dans les métadonnées `quality` de chaque variante (`audio_languages`, `audio_language_class`, `audio_language_allowed`).

## Notes de sécurité

Le Compose fourni publie par défaut le service uniquement sur `127.0.0.1`. Pour l’utiliser depuis un autre appareil de confiance, liez-le à une adresse privée ou passez par WireGuard. Une liaison sur `0.0.0.0` peut exposer le service sur toutes les interfaces et n’est pas recommandée sans pare-feu ou reverse proxy authentifié.

Vous pouvez générer un secret persistant avec :

```bash
openssl rand -hex 32
```

Ne versionnez jamais cette valeur. Placez-la uniquement dans le fichier `.env` local ou dans un gestionnaire de secrets.

## Mise à jour

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

Le tag `upstream-<SHA>` identifie la révision du code source amont, mais il peut être actualisé lorsque cette image ou son image de base change. Utilisez le digest de l’image lorsqu’une reproductibilité octet par octet est nécessaire.
