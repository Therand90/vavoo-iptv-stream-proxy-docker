# Logical failover transition hardening / Durcissement de la transition du failover logique

## English

This patch addresses three failure modes observed during a real Kodi playback session on the logical `CARTOON NETWORK` group.

### 1. Drain the hidden live-edge buffer before a stall becomes fatal

The proxy can intentionally hide a small number of newest HLS segments to keep Kodi behind the live edge while those segments are prefetched. Previously, a playlist that remained HTTP-fresh but stopped advancing kept that full safety delay until the logical stall watchdog fired.

That could leave already-downloaded media unavailable to Kodi. In the reproduced incident, three prefetched segments remained hidden while Kodi ran out of visible media and eventually closed the demuxer.

The logical path now starts a one-way buffer drain when the current playlist identity has remained unchanged for 60% of the configured logical stall threshold. Once draining starts for the active variant, the hidden live-edge delay remains at zero until the logical group switches to another variant. This releases already-prefetched media to Kodi before the failover decision is reached.

### 2. Bound cold failover candidates to the fast playlist budget

A fallback variant with no cached playlist previously entered the generic playlist retry path, where one request could wait for multiple 30-second attempts. Kodi can terminate playback long before that retry sequence completes.

After at least one logical candidate has already failed, a cold candidate now receives one fresh stream URL and is probed through the existing fast hedged playlist deadline (`VAVOO_PLAYLIST_FAST_FALLBACK_MS`, 3000 ms by default). A failed candidate is therefore rejected quickly so the logical reranker can continue to the next source.

Candidates that already have a cached last-known-good playlist continue to use the established fast stale-playlist recovery path.

### 3. Do not use video score alone to reorder two audio-unknown variants

The audio-language classifier can identify preferred, blocked and some other languages, but some streams expose no usable language metadata. Previously, when two candidates were both `unknown`, the video-quality score alone could move a higher-resolution source ahead of the original VAVOO source order.

Real playback showed that a higher-resolution `unknown` source can have substantially worse audio even while its media probe succeeds. When both candidates have `unknown` (or disabled) audio metadata, the sorter now preserves VAVOO's original source order instead of using the video score as the tie-breaker. Known/preferred audio classifications still keep their existing priority and quality scoring.

## Français

Ce patch corrige trois modes de panne observés pendant une vraie lecture Kodi du groupe logique `CARTOON NETWORK`.

### 1. Vider le buffer caché avant qu'un stall ne devienne fatal

Le proxy peut volontairement masquer quelques segments HLS récents afin de garder Kodi légèrement derrière le bord du direct pendant leur préchargement. Jusqu'ici, une playlist encore fraîche au niveau HTTP mais qui cessait d'avancer conservait tout ce retard jusqu'au déclenchement du watchdog de stall logique.

Des segments déjà téléchargés pouvaient donc rester indisponibles pour Kodi. Lors de l'incident reproduit, trois segments préchargés sont restés cachés pendant que Kodi épuisait les médias visibles puis fermait son démuxeur.

Le chemin logique démarre maintenant un vidage irréversible du buffer lorsque l'identité de la playlist courante reste inchangée pendant 60 % du seuil de stall logique configuré. Une fois ce vidage commencé pour la variante active, le retard de bord du direct reste à zéro jusqu'au passage du groupe logique vers une autre variante. Les segments déjà préchargés sont ainsi rendus à Kodi avant la décision de failover.

### 2. Borner les candidats de secours froids au budget playlist rapide

Une variante de secours sans playlist en cache utilisait auparavant le chemin de retry générique, où une seule requête pouvait attendre plusieurs tentatives de 30 secondes. Kodi peut abandonner la lecture bien avant la fin de cette séquence.

Après l'échec d'au moins un candidat logique, un candidat froid reçoit désormais une URL de stream fraîche puis est sondé via le délai rapide hedgé existant (`VAVOO_PLAYLIST_FAST_FALLBACK_MS`, 3000 ms par défaut). Un candidat en échec est donc rejeté rapidement afin que le reranking logique poursuive immédiatement avec la source suivante.

Les candidats disposant déjà d'une dernière playlist valide en cache conservent le chemin de récupération rapide sur playlist stale existant.

### 3. Ne plus laisser le score vidéo seul réordonner deux variantes à audio inconnu

Le classificateur audio sait reconnaître les langues préférées, bloquées et certaines autres langues, mais certains streams n'exposent aucune métadonnée de langue exploitable. Jusqu'ici, lorsque deux candidats étaient tous les deux `unknown`, le score de qualité vidéo pouvait à lui seul faire passer une source plus définie devant l'ordre d'origine VAVOO.

La lecture réelle a montré qu'une source `unknown` de plus haute définition peut avoir un son nettement moins bon alors que sa sonde média réussit. Lorsque les deux candidats ont un audio `unknown` (ou que le filtre est désactivé), le tri conserve maintenant l'ordre d'origine VAVOO au lieu d'utiliser le score vidéo comme départage. Les classifications audio connues/préférées conservent leur priorité et leur scoring actuels.
