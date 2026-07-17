#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
GIT_REF="${GIT_REF:-main}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

update_status() {
  local state="$1"
  local message="$2"
  [[ -n "${STATUS_PATH:-}" ]] || return 0
  printf '{"state":"%s","message":"%s","target":"%s","updated_at":"%s"}\n' \
    "${state}" "${message}" "${GIT_REF}" "$(date -Is)" >"${STATUS_PATH}"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_env_value() {
  local key="$1"
  local value="$2"
  local file="${3:-.env}"

  if [[ ! -f "${file}" ]]; then
    if [[ -f ".env.example" ]]; then
      cp .env.example "${file}"
    else
      touch "${file}"
    fi
  fi

  if grep -qE "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

ensure_env_default() {
  local key="$1"
  local value="$2"
  local file="${3:-.env}"

  if [[ ! -f "${file}" ]]; then
    if [[ -f ".env.example" ]]; then
      cp .env.example "${file}"
    else
      touch "${file}"
    fi
  fi

  if ! grep -qE "^${key}=" "${file}"; then
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

install_update_watcher() {
  local request_path="${APP_DIR}/data/update-request.json"
  local status_path="${APP_DIR}/data/update-status.json"

  install -d -m 0755 "${APP_DIR}/data"
  install -m 0755 "${APP_DIR}/scripts/lxc-apply-update.sh" \
    /usr/local/sbin/roon-ai-bridge-apply-update

  cat >/etc/systemd/system/roon-ai-bridge-update.service <<EOF
[Unit]
Description=Apply a requested Roon AI Bridge update
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
ExecStart=/usr/local/sbin/roon-ai-bridge-apply-update
EOF

  cat >/etc/systemd/system/roon-ai-bridge-update.path <<EOF
[Unit]
Description=Watch for Roon AI Bridge update requests

[Path]
PathExists=${request_path}
Unit=roon-ai-bridge-update.service

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl reset-failed roon-ai-bridge-update.service roon-ai-bridge-update.path >/dev/null 2>&1 || true
  systemctl enable --now roon-ai-bridge-update.path
}

main() {
  require_command git
  require_command docker

  [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout."

  log "Updating ${APP_DIR} from GitHub"
  cd "${APP_DIR}"

  update_status downloading "Descargando la build más reciente"
  git fetch origin "${GIT_REF}"
  git checkout "${GIT_REF}"
  git pull --ff-only origin "${GIT_REF}"

  log "Applying browse environment defaults"
  ensure_env_value ENABLE_BROWSE true .env
  ensure_env_value ROON_EXTENSION_NAME RoonIA .env
  ensure_env_default ENABLE_AUTH false .env
  ensure_env_default API_TOKEN "" .env

  log "Installing safe host update watcher"
  install_update_watcher

  log "Rebuilding and restarting Docker Compose service"
  update_status updating "Instalando y compilando la actualización"
  BUILD_COMMIT="$(git rev-parse HEAD)"
  INSTALLED_CHANNEL="stable"
  [[ "${GIT_REF}" == "beta" ]] && INSTALLED_CHANNEL="beta"
  update_status restarting "Reiniciando el bridge y el portal"
  GIT_COMMIT="${BUILD_COMMIT}" INSTALLED_CHANNEL="${INSTALLED_CHANNEL}" docker compose up -d --build

  update_status verifying "Verificando que el servicio está operativo"
  for _ in $(seq 1 30); do
    if [[ "$(docker inspect -f '{{.State.Running}}' roon-ai-bridge 2>/dev/null || true)" == "true" ]]; then
      break
    fi
    sleep 1
  done
  [[ "$(docker inspect -f '{{.State.Running}}' roon-ai-bridge 2>/dev/null || true)" == "true" ]] || die "Updated container did not become operational"

  log "Update finished"
  docker compose ps
}

main "$@"
