#!/bin/sh

# EN: Native Docker lifecycle helper for LibreELEC systems without Docker Compose.
# FR : Gestionnaire Docker natif pour les systèmes LibreELEC sans Docker Compose.

set -eu

NAME="${VAVOO_CONTAINER_NAME:-vavoo-iptv-stream-proxy}"
IMAGE="${VAVOO_IMAGE:-ghcr.io/therand90/vavoo-iptv-stream-proxy:latest}"
CONFIG_DIR="${VAVOO_CONFIG_DIR:-/storage/docker/vavoo-iptv-stream-proxy}"
ENV_FILE="${VAVOO_ENV_FILE:-$CONFIG_DIR/.env}"
LAST_GOOD_ENV="${VAVOO_LAST_GOOD_ENV:-$CONFIG_DIR/.env.last-known-good}"
ROLLBACK_IMAGE="${VAVOO_ROLLBACK_IMAGE:-vavoo-iptv-stream-proxy:rollback}"
SOURCE_LABEL="org.opencontainers.image.source=https://github.com/Therand90/vavoo-iptv-stream-proxy-docker"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error / Erreur: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage / Utilisation:
  libreelec-vavoo.sh install    Install a new container / Installer un nouveau conteneur
  libreelec-vavoo.sh snapshot   Save the current known-good runtime config / Sauvegarder la configuration d'exécution saine
  libreelec-vavoo.sh update     Pull, validate and apply the latest image / Télécharger, valider et appliquer la dernière image
  libreelec-vavoo.sh status     Show container and endpoint status / Afficher l'état du conteneur et du service
  libreelec-vavoo.sh logs       Show the latest container logs / Afficher les derniers journaux
  libreelec-vavoo.sh cleanup    Remove old unused VAVOO images only / Supprimer uniquement les anciennes images VAVOO inutilisées
  libreelec-vavoo.sh uninstall  Remove the container, keep configuration / Supprimer le conteneur et conserver la configuration
  libreelec-vavoo.sh help       Show this help / Afficher cette aide

Environment overrides / Surcharges d'environnement:
  VAVOO_CONFIG_DIR, VAVOO_ENV_FILE, VAVOO_LAST_GOOD_ENV, VAVOO_IMAGE, VAVOO_CONTAINER_NAME
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command / commande absente: $1"
}

env_value_from() {
  source_file="$1"
  key="$2"
  fallback="$3"
  value="$(
    awk -v wanted="$key" '
      /^[[:space:]]*#/ { next }
      {
        line = $0
        sub(/\r$/, "", line)
        separator = index(line, "=")
        if (separator == 0) {
          next
        }
        name = substr(line, 1, separator - 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
        if (name == wanted) {
          print substr(line, separator + 1)
          exit
        }
      }
    ' "$source_file"
  )"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

load_config_file() {
  config_file="$1"
  [ -f "$config_file" ] || fail "$config_file not found / introuvable"

  RUNTIME_ENV_FILE="$config_file"
  BIND_ADDRESS="$(env_value_from "$config_file" VAVOO_BIND_ADDRESS 127.0.0.1)"
  WIREGUARD_BIND_ADDRESS="$(env_value_from "$config_file" VAVOO_WIREGUARD_BIND_ADDRESS '')"
  PORT="$(env_value_from "$config_file" VAVOO_PORT 8899)"
  LANGUAGE="$(env_value_from "$config_file" VAVOO_LANGUAGE en)"
  REGION="$(env_value_from "$config_file" VAVOO_REGION US)"
  URL_LIST="$(env_value_from "$config_file" VAVOO_URL_LIST both)"

  case "$PORT" in
    ''|*[!0-9]*) fail "VAVOO_PORT must be numeric / doit être numérique" ;;
  esac

  case "$BIND_ADDRESS$WIREGUARD_BIND_ADDRESS$LANGUAGE$REGION$URL_LIST" in
    *'
'*|*' '*|*'\t'*) fail "network and command values must not contain whitespace / les valeurs réseau et de commande ne doivent pas contenir d'espaces" ;;
  esac

  if [ -n "$WIREGUARD_BIND_ADDRESS" ]; then
    case "$WIREGUARD_BIND_ADDRESS" in
      0.0.0.0|::)
        fail "VAVOO_WIREGUARD_BIND_ADDRESS must target a specific trusted interface / doit viser une interface privée précise"
        ;;
    esac
  fi

  case "$BIND_ADDRESS" in
    0.0.0.0|127.0.0.1) HEALTH_HOST="127.0.0.1" ;;
    *) HEALTH_HOST="$BIND_ADDRESS" ;;
  esac
}

load_config() {
  [ -f "$ENV_FILE" ] || fail "$ENV_FILE not found / introuvable. Copy .env.example to .env first / Copiez d'abord .env.example vers .env."
  load_config_file "$ENV_FILE"
}

validate_secondary_bind() {
  [ -n "$WIREGUARD_BIND_ADDRESS" ] || return 0
  [ "$WIREGUARD_BIND_ADDRESS" != "$BIND_ADDRESS" ] || return 0

  if ip -o addr show | awk -v wanted="$WIREGUARD_BIND_ADDRESS" '
    {
      split($4, address, "/")
      if (address[1] == wanted) {
        found = 1
      }
    }
    END { exit(found ? 0 : 1) }
  '; then
    return 0
  fi

  say "Secondary bind address is not assigned locally / L'adresse de liaison secondaire n'est pas présente localement: $WIREGUARD_BIND_ADDRESS"
  return 1
}

expected_bindings() {
  {
    printf '%s:%s\n' "$BIND_ADDRESS" "$PORT"
    if [ -n "$WIREGUARD_BIND_ADDRESS" ] && [ "$WIREGUARD_BIND_ADDRESS" != "$BIND_ADDRESS" ]; then
      printf '%s:%s\n' "$WIREGUARD_BIND_ADDRESS" "$PORT"
    fi
  } | sort
}

current_bindings() {
  docker port "$NAME" 8888/tcp 2>/dev/null | sort
}

snapshot_runtime_config() {
  umask 077
  cp "$ENV_FILE" "$LAST_GOOD_ENV"
  chmod 600 "$LAST_GOOD_ENV"
  say "Known-good runtime config saved / Configuration d'exécution saine sauvegardée: $LAST_GOOD_ENV"
}

snapshot_current_container() {
  load_config

  docker inspect "$NAME" >/dev/null 2>&1 || fail "container not installed / conteneur non installé: $NAME"
  validate_secondary_bind || fail "current configuration cannot be snapshotted / la configuration actuelle ne peut pas être sauvegardée"

  expected="$(expected_bindings)"
  current="$(current_bindings)"
  if [ "$expected" != "$current" ]; then
    say "Expected bindings from .env / Liaisons attendues d'après .env:"
    printf '%s\n' "$expected"
    say "Current container bindings / Liaisons actuelles du conteneur:"
    printf '%s\n' "$current"
    fail "the running container does not match .env; restore .env to the running configuration before snapshotting / le conteneur actif ne correspond pas à .env ; restaurez .env selon la configuration active avant la sauvegarde"
  fi

  snapshot_runtime_config
}

run_container() {
  selected_image="$1"
  runtime_env_file="${2:-$RUNTIME_ENV_FILE}"

  set -- --publish "${BIND_ADDRESS}:${PORT}:8888"
  if [ -n "$WIREGUARD_BIND_ADDRESS" ] && [ "$WIREGUARD_BIND_ADDRESS" != "$BIND_ADDRESS" ]; then
    set -- "$@" --publish "${WIREGUARD_BIND_ADDRESS}:${PORT}:8888"
  fi

  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    --init \
    --env-file "$runtime_env_file" \
    "$@" \
    --read-only \
    --tmpfs "/tmp:rw,size=16m,mode=1777" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 128 \
    --stop-timeout 15 \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    "$selected_image" \
    --http-host 0.0.0.0 \
    --http-port 8888 \
    --vavoo-language "$LANGUAGE" \
    --vavoo-region "$REGION" \
    --vavoo-url-list "$URL_LIST"
}

wait_until_ready() {
  attempts=0
  while [ "$attempts" -lt 45 ]; do
    if curl -fsS "http://${HEALTH_HOST}:${PORT}/countries" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  return 1
}

show_status() {
  if ! docker inspect "$NAME" >/dev/null 2>&1; then
    say "Container not installed / Conteneur non installé: $NAME"
    return 1
  fi

  docker ps -a \
    --filter "name=^/${NAME}$" \
    --format 'Container/Conteneur={{.Names}} | State/État={{.Status}} | Image={{.Image}}'

  if wait_until_ready; then
    say "Endpoint ready / Service disponible: http://${HEALTH_HOST}:${PORT}/countries"
    if [ -n "$WIREGUARD_BIND_ADDRESS" ] && [ "$WIREGUARD_BIND_ADDRESS" != "$BIND_ADDRESS" ]; then
      say "WireGuard endpoint / Service WireGuard: http://${WIREGUARD_BIND_ADDRESS}:${PORT}/countries"
    fi
  else
    say "Endpoint unavailable / Service indisponible: http://${HEALTH_HOST}:${PORT}/countries"
    return 1
  fi
}

cleanup_images() {
  image_ids="$(
    docker image ls -q \
      --filter dangling=true \
      --filter "label=$SOURCE_LABEL" |
      sort -u
  )"

  if [ -z "$image_ids" ]; then
    say "No unused VAVOO image to remove / Aucune ancienne image VAVOO inutilisée à supprimer."
    return 0
  fi

  for image_id in $image_ids; do
    docker image rm "$image_id" >/dev/null 2>&1 || true
  done

  say "Unused VAVOO images removed / Anciennes images VAVOO inutilisées supprimées."
}

restore_previous_image() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true

  if ! docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    say "Rollback image unavailable / Image de secours indisponible."
    return 1
  fi

  if [ ! -f "$LAST_GOOD_ENV" ]; then
    say "Rollback runtime config unavailable / Configuration d'exécution de secours indisponible: $LAST_GOOD_ENV"
    return 1
  fi

  load_config_file "$LAST_GOOD_ENV"
  if ! validate_secondary_bind; then
    say "Rollback bind validation failed / Validation de la liaison de secours échouée."
    return 1
  fi

  if ! run_container "$ROLLBACK_IMAGE" "$LAST_GOOD_ENV" >/dev/null; then
    say "Rollback container creation failed / Échec de création du conteneur de secours."
    return 1
  fi

  if wait_until_ready; then
    say "Previous image and runtime config restored / Image et configuration d'exécution précédentes restaurées."
    return 0
  fi

  say "Previous image restarted but endpoint validation failed / Image précédente redémarrée mais validation du service échouée."
  return 1
}

install_container() {
  load_config
  validate_secondary_bind || fail "secondary bind validation failed / validation de la liaison secondaire échouée"

  if docker inspect "$NAME" >/dev/null 2>&1; then
    fail "container already exists; use update / le conteneur existe déjà ; utilisez update"
  fi

  say "Pulling validated image / Téléchargement de l'image validée..."
  docker pull "$IMAGE"
  run_container "$IMAGE" "$ENV_FILE" >/dev/null

  say "Waiting for the catalog / Attente du catalogue..."
  if ! wait_until_ready; then
    docker logs --tail 100 "$NAME" >&2 || true
    fail "the container did not become ready / le conteneur n'est pas devenu disponible"
  fi

  snapshot_runtime_config
  say "Installation successful / Installation réussie."
  show_status
}

update_container() {
  load_config

  old_image_id="$(docker inspect -f '{{.Image}}' "$NAME" 2>/dev/null || true)"
  if [ -z "$old_image_id" ]; then
    say "No existing container; running first installation / Aucun conteneur existant ; première installation."
    install_container
    return
  fi

  validate_secondary_bind || fail "secondary bind validation failed; current container was kept / validation de la liaison secondaire échouée ; le conteneur actuel a été conservé"

  if [ ! -f "$LAST_GOOD_ENV" ]; then
    fail "no known-good runtime snapshot; run 'libreelec-vavoo.sh snapshot' before the first update with this helper / aucune configuration d'exécution saine sauvegardée ; lancez 'libreelec-vavoo.sh snapshot' avant la première mise à jour avec ce gestionnaire"
  fi

  say "Preparing temporary rollback image / Préparation de l'image temporaire de secours..."
  docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
  docker image tag "$old_image_id" "$ROLLBACK_IMAGE"

  say "Pulling latest validated image / Téléchargement de la dernière image validée..."
  if ! docker pull "$IMAGE"; then
    docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
    fail "image download failed; current container was kept / téléchargement échoué ; le conteneur actuel a été conservé"
  fi

  docker rm -f "$NAME" >/dev/null 2>&1 || true

  if ! run_container "$IMAGE" "$ENV_FILE" >/dev/null; then
    say "New container creation failed; restoring previous image and runtime config / Échec de création ; restauration de l'image et de la configuration précédentes..."
    restore_previous_image || true
    fail "update failed / mise à jour échouée"
  fi

  say "Validating the new container / Validation du nouveau conteneur..."
  if ! wait_until_ready; then
    docker logs --tail 100 "$NAME" >&2 || true
    say "Validation failed; restoring previous image and runtime config / Échec de validation ; restauration de l'image et de la configuration précédentes..."
    restore_previous_image || true
    fail "update failed / mise à jour échouée"
  fi

  snapshot_runtime_config
  docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
  cleanup_images

  say "Update successful / Mise à jour réussie."
  show_status
}

main() {
  require_command docker
  require_command awk
  require_command curl
  require_command sort
  require_command ip
  require_command cp

  command_name="${1:-help}"
  case "$command_name" in
    install) install_container ;;
    snapshot) snapshot_current_container ;;
    update) update_container ;;
    status)
      load_config
      show_status
      ;;
    logs)
      docker logs --tail "${VAVOO_LOG_LINES:-100}" "$NAME"
      ;;
    cleanup) cleanup_images ;;
    uninstall)
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      say "Container removed; configuration kept in $CONFIG_DIR / Conteneur supprimé ; configuration conservée dans $CONFIG_DIR."
      ;;
    help|-h|--help) usage ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
