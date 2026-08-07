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
| `VAVOO_WIREGUARD_BIND_ADDRESS` | vide | Seconde adresse d’hôte facultative utilisée par le gestionnaire LibreELEC natif. Elle conserve la boucle locale pour Kodi tout en publiant le même port sur une adresse WireGuard privée précise. `0.0.0.0` est refusé. |
| `VAVOO_PORT` | `8899` | Port de l’hôte redirigé vers le port `8888` du conteneur. |
| `VAVOO_LANGUAGE` | `en` | Langue envoyée aux API amont. |
| `VAVOO_REGION` | `US` | Région envoyée aux API amont. `US` conserve généralement un catalogue large. |
| `VAVOO_URL_LIST` | `both` | Sélection des sources amont : `primary`, `fallback` ou `both`. |
| `VAVOO_CHANNELS_CACHE_TTL_SECONDS` | `21600` | Durée du cache du catalogue. Les valeurs inférieures à 300 secondes reviennent à la valeur par défaut. |

`VAVOO_WIREGUARD_BIND_ADDRESS` est actuellement utilisé par `scripts/libreelec-vavoo.sh` ; le fichier Compose fourni continue d’utiliser uniquement `VAVOO_BIND_ADDRESS`. Sur LibreELEC, une configuration privée typique est :

```dotenv
VAVOO_BIND_ADDRESS=127.0.0.1
VAVOO_WIREGUARD_BIND_ADDRESS=10.13.13.2
VAVOO_PORT=8899
```

Cela crée deux liaisons d’hôte vers le même port du conteneur : la boucle locale pour Kodi et l’adresse WireGuard choisie pour les vérifications distantes de confiance. N’utilisez jamais une adresse publique ni `0.0.0.0` comme seconde liaison.

## Résilience de la lecture

| Variable | Valeur par défaut | Rôle |
|---|---:|---|
| `VAVOO_STREAM_URL_TTL_SECONDS` | `3000` | Durée de vie locale d’une URL de flux signée. Cinquante minutes permettent son renouvellement avant l’expiration horaire habituelle. Les valeurs inférieures à 300 reviennent à la valeur par défaut. |
| `VAVOO_PLAYLIST_CACHE_TTL_SECONDS` | `300` | Durée de conservation de la dernière playlist média valide utilisée pendant une panne amont temporaire. |
| `VAVOO_HLS_ASSET_CACHE_TTL_SECONDS` | `45` | Durée du cache mémoire court des ressources média HLS téléchargées avec succès. |
| `VAVOO_HLS_ASSET_MAX_CACHE_BYTES` | `12582912` | Taille maximale d’une ressource média mise en cache, en octets. La valeur par défaut correspond à 12 Mio. |
| `VAVOO_HLS_PREFETCH_SEGMENT_COUNT` | `2` | Nombre de segments média les plus récents préchargés depuis chaque playlist renouvelée. Utilisez `0` pour désactiver le préchargement. |
| `VAVOO_HLS_PROXY_SECRET` | généré au démarrage | Secret persistant facultatif utilisé pour signer les URL internes `/hls-proxy`. Laissez-le vide pour un seul conteneur. Utilisez le même secret robuste sur chaque réplique lorsque plusieurs instances doivent accepter mutuellement leurs URL signées. |

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
