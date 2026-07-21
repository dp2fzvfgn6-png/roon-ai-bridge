#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
GIT_REF="${GIT_REF:-main}"
STATUS_PATH="${STATUS_PATH:-${APP_DIR}/data/update-status.json}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/dp2fzvfgn6-png/roon-ai-bridge}"
CONTAINER_NAME="${CONTAINER_NAME:-roon-ai-bridge}"
BACKUP_DIR="${APP_DIR}/data/backups"
RELEASE_PATH="${APP_DIR}/data/installed-release.json"

CHANNEL="stable"
[[ "${GIT_REF}" == "beta" ]] && CHANNEL="beta"
IMAGE_REF="${IMAGE_REPOSITORY}:${CHANNEL}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

update_status() {
  local state="$1"
  local message="$2"
  printf '{"state":"%s","message":"%s","target":"%s","updated_at":"%s"}\n' \
    "${state}" "${message}" "${GIT_REF}" "$(date -Is)" >"${STATUS_PATH}"
}

ensure_env_value() {
  local key="$1"
  local value="$2"
  local file="${3:-.env}"
  [[ -f "${file}" ]] || cp .env.example "${file}"
  if grep -qE "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

container_ready() {
  local running health
  running="$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  [[ "${running}" == "true" ]] || return 1
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  [[ "${health}" == "healthy" || "${health}" == "none" ]]
}

restore_previous_release() {
  local previous_image_id="$1"
  local backup_path="$2"

  log "Recuperando la versión anterior"
  docker compose stop -t 15 || true

  if [[ -f "${APP_DIR}/.env.before-update" ]]; then
    cp "${APP_DIR}/.env.before-update" "${APP_DIR}/.env"
  fi

  if [[ -n "${backup_path}" && -f "${backup_path}" ]]; then
    local data_dir
    data_dir="$(readlink -f "${APP_DIR}/data")"
    case "${data_dir}" in
      "${APP_DIR}"/*)
        find "${data_dir}" -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf -- {} +
        tar -xzf "${backup_path}" -C "${data_dir}"
        ;;
      *)
        printf 'No se restaura una ruta de datos inesperada: %s\n' "${data_dir}" >&2
        ;;
    esac
  fi

  if [[ -n "${previous_image_id}" ]]; then
    docker image tag "${previous_image_id}" "${IMAGE_REPOSITORY}:stable"
    docker image tag "${previous_image_id}" "${IMAGE_REPOSITORY}:beta"
    docker compose up -d --no-build
  fi
}

main() {
  cd "${APP_DIR}"
  install -d -m 0755 "${BACKUP_DIR}"

  local previous_image_id backup_path
  previous_image_id="$(docker inspect -f '{{.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  backup_path="${BACKUP_DIR}/pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"

  [[ -f .env ]] && cp .env .env.before-update
  ensure_env_value ROONIA_IMAGE_TAG "${CHANNEL}" .env
  ensure_env_value INSTALLED_CHANNEL "${CHANNEL}" .env
  ensure_env_value ENABLE_BROWSE true .env
  ensure_env_value ROON_EXTENSION_NAME RoonIA .env

  update_status downloading "Descargando la nueva versión ya preparada"
  if ! docker compose pull; then
    restore_previous_release "${previous_image_id}" ""
    return 1
  fi

  update_status updating "Creando una copia de seguridad de los datos"
  if ! docker compose stop -t 15; then
    restore_previous_release "${previous_image_id}" ""
    return 1
  fi
  if ! tar --exclude='./backups' -czf "${backup_path}" -C "${APP_DIR}/data" .; then
    rm -f "${backup_path}"
    restore_previous_release "${previous_image_id}" ""
    return 1
  fi

  update_status restarting "Iniciando la nueva versión"
  if ! docker compose up -d --no-build; then
    restore_previous_release "${previous_image_id}" "${backup_path}"
    return 1
  fi

  update_status verifying "Comprobando que la aplicación responde correctamente"
  for _ in $(seq 1 60); do
    if container_ready; then
      break
    fi
    sleep 1
  done

  if ! container_ready; then
    restore_previous_release "${previous_image_id}" "${backup_path}"
    return 1
  fi

  local image_id version revision image_digest
  image_id="$(docker inspect -f '{{.Image}}' "${CONTAINER_NAME}")"
  version="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "${image_id}" 2>/dev/null || true)"
  revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${image_id}" 2>/dev/null || true)"
  image_digest="$(docker image inspect -f '{{index .RepoDigests 0}}' "${image_id}" 2>/dev/null || true)"

  printf '{"version":"%s","revision":"%s","channel":"%s","image":"%s","image_digest":"%s","installed_at":"%s"}\n' \
    "${version:-unknown}" "${revision:-unknown}" "${CHANNEL}" "${image_id}" "${image_digest:-unknown}" "$(date -Is)" >"${RELEASE_PATH}"

  rm -f "${APP_DIR}/.env.before-update"
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'pre-update-*.tar.gz' -printf '%T@ %p\n' \
    | sort -rn | awk 'NR>5 {sub(/^[^ ]+ /, ""); print}' | xargs -r rm -f --

  log "Actualización completada"
  docker compose ps
}

main "$@"
