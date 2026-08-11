[English](LIBREELEC.md) | [Français](LIBREELEC.fr.md)

# Installation LibreELEC sans Docker Compose

L’extension Docker de LibreELEC fournit le moteur Docker, mais certaines installations n’incluent pas la commande `docker compose`. Ce dépôt fournit donc un gestionnaire natif `/bin/sh` capable d’installer, mettre à jour, valider et supprimer le conteneur avec les commandes Docker ordinaires.

> [!IMPORTANT]
> L’image actuellement publiée cible `linux/amd64`. Ce guide est donc destiné aux systèmes LibreELEC x86_64, par exemple les mini-PC Intel et AMD. La prise en charge ARM nécessitera une future image multiarchitecture.

## 1. Installer Docker et activer SSH

Dans Kodi, installez le service **Docker** depuis le dépôt officiel des extensions LibreELEC, puis activez SSH dans les paramètres LibreELEC.

Connectez-vous ensuite à LibreELEC en SSH.

## 2. Télécharger le gestionnaire et la configuration

```sh
mkdir -p /storage/docker/vavoo-iptv-stream-proxy
cd /storage/docker/vavoo-iptv-stream-proxy

wget -O libreelec-vavoo.sh \
  https://raw.githubusercontent.com/Therand90/vavoo-iptv-stream-proxy-docker/main/scripts/libreelec-vavoo.sh

wget -O .env.example \
  https://raw.githubusercontent.com/Therand90/vavoo-iptv-stream-proxy-docker/main/.env.example

[ -f .env ] || cp .env.example .env
chmod +x libreelec-vavoo.sh
```

Vérifiez le fichier `.env` avant l’installation. La valeur sûre par défaut publie le proxy uniquement sur `127.0.0.1:8899`.

Pour créer une seule fois un secret persistant de signature HLS interne :

```sh
secret="$(head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1)"
sed -i "s|^VAVOO_HLS_PROXY_SECRET=.*|VAVOO_HLS_PROXY_SECRET=$secret|" .env
```

Le gestionnaire n’exécute pas `.env` comme du code shell. Il transmet le fichier complet à Docker avec `--env-file` et ne lit que les quelques valeurs nécessaires à la publication du port et aux arguments de commande.

### Accès WireGuard privé facultatif

Conservez la liaison locale normale pour Kodi et définissez une seconde liaison facultative lorsqu’un autre pair WireGuard de confiance doit interroger ou tester directement le proxy :

```dotenv
VAVOO_BIND_ADDRESS=127.0.0.1
VAVOO_WIREGUARD_BIND_ADDRESS=10.13.13.2
VAVOO_PORT=8899
```

Le gestionnaire LibreELEC publie alors à la fois `127.0.0.1:8899` et `10.13.13.2:8899` vers le port `8888` du conteneur. Kodi conserve donc son accès local tandis que le service n’est exposé à distance que sur l’interface WireGuard choisie.

Laissez `VAVOO_WIREGUARD_BIND_ADDRESS` vide lorsqu’elle n’est pas nécessaire. Le gestionnaire refuse `0.0.0.0` pour cette seconde liaison ; n’utilisez jamais une adresse publique à cet endroit.

## 3. Installer le conteneur

```sh
./libreelec-vavoo.sh install
```

Le gestionnaire télécharge l’image publique validée, crée le conteneur renforcé et attend que le catalogue des chaînes réponde avant d’annoncer la réussite.

Les points d’entrée utiles sur l’hôte LibreELEC sont :

```text
http://127.0.0.1:8899/countries
http://127.0.0.1:8899/channels.m3u8
http://127.0.0.1:8899/channels.m3u8?country=France
```

Lorsque la seconde liaison WireGuard est configurée, ces mêmes chemins sont également accessibles sur cette adresse privée précise.

## Commandes courantes

```sh
./libreelec-vavoo.sh status
./libreelec-vavoo.sh logs
./libreelec-vavoo.sh update
```

La commande `update` effectue cette séquence protégée :

1. elle étiquette temporairement l’image actuellement utilisée comme secours ;
2. elle télécharge la dernière image validée ;
3. elle recrée le conteneur avec le fichier `.env` actuel ;
4. elle attend que `/countries` réponde ;
5. elle restaure automatiquement l’image précédente si la validation échoue ;
6. après réussite, elle supprime le secours temporaire et uniquement les anciennes images inutilisées produites par ce dépôt.

La commande ne lance pas de `docker image prune` global et ne nettoie donc pas les autres services Docker.

Les mises à jour ne sont pas planifiées automatiquement. Lancez la commande `update` lorsqu’une nouvelle image est disponible ou lorsque vous souhaitez resynchroniser le conteneur.

## Migrer un conteneur manuel existant

Lorsqu’un conteneur existant porte déjà le nom `vavoo-iptv-stream-proxy`, recopiez d’abord les réglages souhaités dans le nouveau `.env`, puis lancez :

```sh
./libreelec-vavoo.sh update
```

Le gestionnaire détecte le conteneur existant et utilise son image actuelle comme secours temporaire pendant la migration.

Vous pouvez sauvegarder son inspection complète avant la migration :

```sh
docker inspect vavoo-iptv-stream-proxy \
  > /storage/vavoo-iptv-stream-proxy.inspect.json
```

## Nettoyage et suppression

Supprimer uniquement les anciennes images inutilisées produites par ce dépôt :

```sh
./libreelec-vavoo.sh cleanup
```

Supprimer le conteneur tout en conservant `.env` et le gestionnaire :

```sh
./libreelec-vavoo.sh uninstall
```

Supprimez manuellement le dossier de configuration seulement lorsqu’il n’est plus nécessaire.

## Notes de sécurité

Le gestionnaire applique les principales protections d’exécution du fichier `compose.yaml` :

- publication limitée à la boucle locale par défaut ;
- publication facultative sur une adresse WireGuard privée explicite ;
- système de fichiers racine en lecture seule ;
- suppression de toutes les capabilities Linux ;
- `no-new-privileges` ;
- petit `tmpfs` limité sous `/tmp` ;
- limite de processus ;
- rotation des journaux ;
- politique de redémarrage `unless-stopped`.

N’exposez pas directement le proxy sur Internet. Conservez la boucle locale par défaut ou utilisez un réseau privé de confiance tel que WireGuard.
