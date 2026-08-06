[English](CONTRIBUTING.md) | [Français](CONTRIBUTING.fr.md)

# Contribuer

Merci de contribuer à l’amélioration de cette image Docker et de ses correctifs de lecture.

## Avant de proposer une modification

1. Repartez de la dernière version de `main`.
2. Créez une branche ciblée telle que `fix/...`, `feat/...` ou `docs/...`.
3. Séparez les modifications sans rapport dans des pull requests distinctes.
4. Ne versionnez jamais d’identifiants, d’URL de flux signées, de noms d’hôtes privés, d’adresses IP personnelles ou de véritable fichier `.env`.

## Convention bilingue du projet

La documentation publique doit être disponible en anglais et en français :

- l’anglais utilise le nom standard, par exemple `README.md` ou `SECURITY.md` ;
- le français utilise le suffixe `.fr.md`, par exemple `README.fr.md` ;
- chaque paire de documents comporte un sélecteur de langue en tête ;
- les commentaires expliquant du code ou une configuration non évidente doivent contenir une ligne anglaise suivie de son équivalent français ;
- les messages des journaux d’exécution peuvent rester en anglais afin de faciliter les recherches et de conserver une terminologie cohérente.

## Conception des correctifs

Les fichiers du dossier `patches/` modifient volontairement une implémentation amont précise pendant la construction de l’image.

- Utilisez des ancres exactes et auditables.
- Vérifiez que chaque ancre attendue apparaît exactement une fois.
- Faites échouer la construction lorsque le code amont ne correspond plus.
- Évitez les expressions régulières trop larges et les remplacements silencieux en mode « meilleur effort ».
- Ne journalisez jamais les URL signées complètes ni les secrets.
- Documentez toute nouvelle variable d’environnement dans les deux guides de configuration et dans `.env.example`.

## Validation

Une pull request doit au minimum :

- construire correctement l’image Docker ;
- réussir `node --check` sur l’application corrigée ;
- conserver les contrôles de correctifs qui échouent de manière sûre ;
- réussir les smoke tests du catalogue et des flux HLS dans GitHub Actions ;
- ne publier aucune image depuis le workflow de pull request.

Lorsqu’une modification concerne la lecture longue durée ou la récupération après erreur, décrivez dans la pull request le test réalisé avec un lecteur réel et les observations de journaux préalablement nettoyées.

## Pull requests

Utilisez un titre clair et expliquez ce qui change, pourquoi, l’impact attendu pour l’utilisateur et les validations effectuées. Une description bilingue anglais/français est encouragée pour les modifications importantes visibles par l’utilisateur.

En contribuant, vous acceptez que votre contribution soit distribuée sous la licence MIT de ce dépôt et que les éventuels fragments conservés du projet amont restent soumis à son copyright et à sa licence MIT décrits dans `THIRD_PARTY_NOTICES.md`.
