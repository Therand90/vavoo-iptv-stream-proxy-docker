# VAVOO IPTV Stream Proxy — Docker

Image Docker reproductible pour le projet amont [`Haehnchen/vavoo-iptv-stream-proxy`](https://github.com/Haehnchen/vavoo-iptv-stream-proxy).

L’image récupère un commit précis du dépôt original pendant la construction, applique un petit correctif local auditable, installe les dépendances avec Node.js 24, exécute des tests simples, puis publie l’image validée sur GitHub Container Registry.

## Image

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:latest
```

Chaque version validée reçoit aussi un tag lié au commit amont :

```text
ghcr.io/therand90/vavoo-iptv-stream-proxy:upstream-<12-premiers-caracteres-du-SHA>
```

## Correctif local du cache catalogue

Le projet amont conserve le catalogue des chaînes pendant cinq minutes. En mode `--redirect`, une URL signée de lecture peut expirer après environ une heure. Kodi redemande alors une URL fraîche au proxy, mais le rechargement complet de plus de dix mille chaînes peut prendre plusieurs secondes et faire expirer la tentative de reprise du lecteur.

Cette image porte donc la durée du cache du catalogue à six heures par défaut :

```text
VAVOO_CHANNELS_CACHE_TTL_SECONDS=21600
```

Le minimum accepté est de 300 secondes. Le correctif ne met pas en cache les URL signées des flux : chaque ouverture ou reprise continue de demander une URL de lecture fraîche.

Le script de construction vérifie que le code amont attendu n’a pas changé avant d’appliquer le correctif. Une modification incompatible du projet original fait échouer la construction au lieu de produire silencieusement une image non corrigée.

## Synchronisation automatique

Le workflow GitHub Actions :

1. vérifie la branche `main` du dépôt original toutes les six heures ;
2. compare son commit avec les images déjà publiées ;
3. construit une nouvelle image lorsqu’un nouveau commit est détecté, ou lorsque le Dockerfile ou les correctifs locaux changent ;
4. vérifie la présence du correctif local ;
5. démarre temporairement l’image et vérifie `/countries` ainsi que la playlist française ;
6. publie les tags `upstream-<SHA>` et `latest` uniquement si les tests réussissent.

Les pull requests exécutent la construction et les tests sans publier d’image. Le workflow peut aussi être lancé manuellement depuis l’onglet **Actions**.

## Déploiement avec Docker Compose

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
```

Par défaut, le service écoute uniquement sur la boucle locale :

```text
http://127.0.0.1:8899
```

Endpoints utiles :

```text
http://<adresse>:8899/countries
http://<adresse>:8899/channels.m3u8?country=France
```

Le conteneur démarre avec `--redirect`. Le proxy résout donc une URL fraîche au lancement d’une chaîne, puis redirige les lecteurs dont le User-Agent contient `VAVOO` vers le flux amont.

## Accès à une image privée

Les paquets GHCR sont privés lors de leur première publication. La machine Docker doit alors être authentifiée auprès de `ghcr.io`, ou le paquet peut être rendu public depuis ses paramètres GitHub.

Exemple d’authentification, avec un jeton disposant du droit de lecture des paquets :

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u Therand90 --password-stdin
```

Ne placez jamais le jeton dans ce dépôt ni directement dans `compose.yaml`.

## Mise à jour

```bash
docker compose pull
docker compose up -d --remove-orphans
```

`pull_policy: always` garantit également que `docker compose up -d` vérifie le tag `latest`.

## Licence

Le code amont est distribué sous licence MIT et sa licence est incluse dans l’image. Les fichiers propres à ce dépôt servent à la construction, aux tests, au correctif local et au déploiement du conteneur.
