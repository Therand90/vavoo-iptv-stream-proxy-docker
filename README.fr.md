[English](README.md) | [Français](README.fr.md)

# VAVOO IPTV Stream Proxy — Docker

Une image Docker validée pour le projet amont [`Haehnchen/vavoo-iptv-stream-proxy`](https://github.com/Haehnchen/vavoo-iptv-stream-proxy).

L’image télécharge un commit amont précis, applique des correctifs de lecture auditables qui échouent de manière sûre, installe les dépendances Node.js verrouillées, exécute des contrôles syntaxiques et des smoke tests réels, puis publie l’image sur GitHub Container Registry uniquement après validation.

> [!IMPORTANT]
> Ce projet communautaire est non officiel et n’est ni affilié à VAVOO ou à l’auteur du projet amont, ni approuvé ou exploité par eux. Le dépôt contient uniquement du logiciel ; il n’intègre aucune chaîne de télévision ni aucun contenu audiovisuel.

## Image du conteneur

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:latest
```

Chaque révision amont validée reçoit également un tag identifiant cette révision :

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:upstream-<12-premiers-caracteres-du-SHA>
```

Utilisez `latest` pour sa simplicité. Le tag `upstream-*` identifie la révision du code source amont, mais il peut être actualisé lorsque cette image ou son image de base change. Utilisez le digest de l’image lorsqu’une reproductibilité octet par octet est importante.

## Apports de cette image

Le proxy amont fournit le catalogue, des identifiants de chaînes locaux stables et la résolution des flux à la demande. Cette image ajoute l’empaquetage Docker et plusieurs améliorations de lecture destinées notamment à Kodi :

1. **Cache prolongé du catalogue** — conserve le catalogue pendant six heures par défaut afin qu’une reprise du lecteur n’attende pas son rechargement complet.
2. **Point d’entrée HLS renouvelable** — maintient Kodi sur une URL locale stable `/hls-channel/:id` et renouvelle les URL amont signées avant leur expiration horaire habituelle.
3. **Récupération des playlists** — réessaie les pannes amont courtes et peut servir la dernière playlist valide pendant l’obtention d’une nouvelle URL signée.
4. **Récupération des segments média** — réessaie les ressources HLS, met les réponses réussies en mémoire tampon et conserve un cache mémoire court et limité pour les nouvelles demandes immédiates du lecteur.
5. **Préchargement des segments** — précharge les segments les plus récents de la playlist et partage les téléchargements déjà en cours avec le lecteur afin de réduire les brèves pauses.
6. **URL internes signées** — signe les URL `/hls-proxy` générées afin que ce point d’entrée ne puisse pas servir de proxy HTTP arbitraire sans signature.

Chaque correctif vérifie que le code amont attendu apparaît exactement une fois. Une modification amont incompatible interrompt la construction au lieu de publier silencieusement une image partiellement corrigée.

## Démarrage rapide

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
```

Par défaut, le Compose écoute uniquement sur l’interface de boucle locale :

```text
http://127.0.0.1:8899
```

Points d’entrée utiles :

```text
http://127.0.0.1:8899/countries
http://127.0.0.1:8899/channels.m3u8
http://127.0.0.1:8899/channels.m3u8?country=France
```

Le mode par défaut conserve la lecture HLS à l’intérieur du proxy local. Il n’active **pas** `--redirect`, car une redirection directe retirerait le proxy du chemin de lecture et empêcherait le renouvellement transparent des URL.

## Configuration

Les principales valeurs par défaut sont :

```dotenv
VAVOO_BIND_ADDRESS=127.0.0.1
VAVOO_PORT=8899
VAVOO_CHANNELS_CACHE_TTL_SECONDS=21600
VAVOO_STREAM_URL_TTL_SECONDS=3000
VAVOO_PLAYLIST_CACHE_TTL_SECONDS=300
VAVOO_HLS_ASSET_CACHE_TTL_SECONDS=45
VAVOO_HLS_ASSET_MAX_CACHE_BYTES=12582912
VAVOO_HLS_PREFETCH_SEGMENT_COUNT=2
```

Consultez la [référence de configuration](docs/CONFIGURATION.fr.md) complète avant de modifier les paramètres de cache, de mémoire ou de réseau.

## Sécurité

> [!WARNING]
> N’exposez pas directement le port `8899` sur Internet. Conservez la liaison locale par défaut ou utilisez un réseau privé de confiance tel que WireGuard. Un reverse proxy authentifié et des règles de pare-feu strictes sont indispensables lorsqu’un accès uniquement local est impossible.

Le conteneur est renforcé par défaut grâce à :

- un utilisateur d’exécution non privilégié ;
- un système de fichiers racine en lecture seule ;
- la suppression de toutes les capabilities Linux ;
- l’activation de `no-new-privileges` ;
- un petit système de fichiers temporaire monté uniquement sous `/tmp` ;
- la publication du port de l’hôte limitée à la boucle locale.

Consultez la [politique de sécurité](SECURITY.fr.md) complète.

## Synchronisation et validation automatiques

GitHub Actions vérifie la branche `main` du projet amont toutes les six heures. Une construction est demandée lorsqu’un nouveau commit amont est détecté ou lorsque cette image est modifiée. Une reconstruction planifiée est également forcée périodiquement afin de ne pas ignorer les correctifs de sécurité de l’image de base lorsque le SHA amont ne change pas.

Avant toute publication, le workflow :

1. résout et enregistre le commit amont exact ;
2. construit l’image corrigée ;
3. vérifie les marqueurs obligatoires des correctifs et leurs valeurs par défaut ;
4. exécute `node --check` pendant la construction Docker ;
5. démarre temporairement l’image ;
6. valide `/countries`, la playlist française et le point d’entrée maître HLS renouvelable ;
7. publie `upstream-<SHA>` et `latest` uniquement lorsque tous les contrôles réussissent.

Les pull requests exécutent les mêmes constructions et smoke tests sans publier d’image.

## Construction depuis les sources

Fournissez un commit amont exact plutôt qu’une branche mouvante :

```bash
docker build \
  --build-arg UPSTREAM_REPO=Haehnchen/vavoo-iptv-stream-proxy \
  --build-arg UPSTREAM_REF=<sha-complet-du-commit-amont> \
  -t vavoo-iptv-stream-proxy:local .
```

La construction exige le fichier `package-lock.json` amont et utilise `npm ci`. Elle échoue au lieu de basculer vers une installation de dépendances non verrouillée.

## Mise à jour

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

Si le paquet GHCR est privé, authentifiez-vous avec un jeton autorisé à lire les paquets :

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u Therand90 --password-stdin
```

Ne versionnez jamais ce jeton et ne le placez pas directement dans `compose.yaml`.

## Documentation

- [Configuration](docs/CONFIGURATION.fr.md)
- [Politique de sécurité](SECURITY.fr.md)
- [Contribution](CONTRIBUTING.fr.md)
- [Notices relatives aux logiciels tiers](THIRD_PARTY_NOTICES.fr.md)

Toute la documentation publique est maintenue en anglais et en français. Les commentaires non évidents du code source et de la configuration suivent la même convention bilingue.

## Licence et avertissement sur les contenus

Les fichiers créés spécifiquement pour ce dépôt sont distribués sous la [licence MIT](LICENSE). Le projet amont reste © 2022 Daniel Espendiller sous sa propre licence MIT ; consultez les [notices relatives aux logiciels tiers](THIRD_PARTY_NOTICES.fr.md).

Ces licences logicielles n’accordent aucun droit sur les chaînes de télévision, les flux, les marques ou les œuvres audiovisuelles. L’utilisateur reste responsable du respect des lois, des conditions de service et des droits applicables aux contenus.
