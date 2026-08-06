[English](SECURITY.md) | [Français](SECURITY.fr.md)

# Politique de sécurité

## Versions prises en charge

Seules la branche `main` actuelle et l’image de conteneur publiée la plus récente sont prises en charge. Les anciennes images `upstream-*` constituent des références immuables utiles au diagnostic et au retour arrière, mais elles ne reçoivent pas de correctifs.

## Signaler une vulnérabilité

Utilisez de préférence le signalement privé de vulnérabilité disponible dans l’onglet **Security** du dépôt. Ne publiez jamais d’identifiants, d’URL de flux signées, d’adresses privées, de détails d’exploitation ou d’autres données sensibles dans une issue publique.

Si le signalement privé n’est pas disponible, contactez d’abord le mainteneur via son profil GitHub et attendez qu’un canal privé soit proposé avant d’envoyer les détails techniques.

## Périmètre de déploiement

Ce service est conçu pour une utilisation locale ou sur un réseau privé de confiance.

- Conservez `VAVOO_BIND_ADDRESS=127.0.0.1` sauf si un accès depuis un réseau privé est explicitement nécessaire.
- N’exposez pas directement le port du conteneur sur Internet.
- Pour un accès distant, privilégiez WireGuard, un autre VPN authentifié ou un reverse proxy authentifié avec des contrôles d’accès stricts.
- Ne placez aucun jeton ou mot de passe dans `compose.yaml`, les couches de l’image Docker, les journaux ou un fichier `.env` versionné.
- Maintenez l’image et l’hôte Docker à jour.

Le proxy HLS local utilise des URL internes signées afin d’empêcher l’utilisation de `/hls-proxy` comme proxy HTTP arbitraire. Cette protection constitue une défense supplémentaire, mais ne rend pas l’exposition publique recommandée ni prise en charge.

## Confiance accordée au projet amont

L’image télécharge un commit amont précis lors des constructions validées par la CI et applique des scripts de correctif qui échouent de manière sûre. Si le code amont ne correspond plus aux ancres attendues, la construction échoue au lieu de produire silencieusement une image non corrigée.

## Sécurité juridique et contenus

Ce dépôt contient uniquement du logiciel. Il n’accorde aucun droit sur les chaînes de télévision, les flux, les marques ou les œuvres audiovisuelles. L’utilisateur reste responsable du respect des lois, des conditions de service et des droits applicables aux contenus.
