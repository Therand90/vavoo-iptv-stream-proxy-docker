# VAVOO IPTV Stream Proxy — Docker

Image Docker reproductible pour le projet amont [`Haehnchen/vavoo-iptv-stream-proxy`](https://github.com/Haehnchen/vavoo-iptv-stream-proxy).

Ce dépôt ne maintient pas une copie modifiée permanente du code amont. L’image récupère un commit précis du dépôt original pendant la construction, installe ses dépendances avec Node.js 24, exécute des tests simples, puis publie l’image validée sur GitHub Container Registry.

## Image

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:latest
```

Chaque version validée reçoit aussi un tag lié au commit amont :

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:upstream-<12-premiers-caracteres-du-SHA>
```

## Synchronisation automatique

Le workflow GitHub Actions :

1. vérifie la branche `main` du dépôt original toutes les six heures ;
2. compare son commit avec les images déjà publiées ;
3. construit une nouvelle image lorsqu’un nouveau commit est détecté, ou lorsque le Dockerfile change ;
4. démarre temporairement l’image et vérifie `/countries` ainsi que la playlist française ;
5. publie les tags `upstream-<SHA>` et `latest` uniquement si les tests réussissent.

Le workflow peut aussi être lancé manuellement depuis l’onglet **Actions**.

## Déploiement avec Docker Compose

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
```

Par défaut, le service écoute uniquement sur la boucle locale du VPS :

```text
http://127.0.0.1:8899
```

Pour le rendre accessible depuis WireGuard sans l’exposer publiquement, modifiez `VAVOO_BIND_ADDRESS` dans `.env` avec l’adresse privée appropriée du VPS.

Endpoints utiles :

```text
http://<adresse>:8899/countries
http://<adresse>:8899/channels.m3u8?country=France
```

Le conteneur démarre avec `--redirect`. Le proxy résout donc une URL fraîche au lancement d’une chaîne, puis redirige les lecteurs dont le User-Agent contient `VAVOO` vers le flux amont.

## Accès à une image privée

Les paquets GHCR sont privés lors de leur première publication. Le VPS doit alors être authentifié auprès de `ghcr.io`, ou le paquet peut être rendu public depuis ses paramètres GitHub.

Exemple d’authentification, avec un jeton disposant du droit de lecture des paquets :

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u Therand90 --password-stdin
```

Ne placez jamais le jeton dans ce dépôt ni directement dans `compose.yaml`.

## Mise à jour sur le VPS

Lors de la maintenance :

```bash
docker compose pull
docker compose up -d --remove-orphans
```

`pull_policy: always` garantit également que `docker compose up -d` vérifie le tag `latest`.

## Licence

Le code amont est distribué sous licence MIT et sa licence est incluse dans l’image. Les fichiers propres à ce dépôt servent uniquement à la construction et au déploiement du conteneur.
