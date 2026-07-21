#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
GIT_REF="${GIT_REF:-main}"
STATUS_PATH="${STATUS_PATH:-${APP_DIR}/data/update-status.json}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

update_status() {
  local state="$1"
  local message="$2"
  printf '{"state":"%s","message":"%s","target":"%s","updated_at":"%s"}\n' \
    "${state}" "${message}" "${GIT_REF}" "$(date -Is)" >"${STATUS_PATH}"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Falta el comando requerido: $1"
}

install_update_watcher() {
  local request_path="${APP_DIR}/data/update-request.json"

  install -d -m 0755 "${APP_DIR}/data"
  install -m 0755 "${APP_DIR}/scripts/lxc-apply-update.sh" \
    /usr/local/sbin/roon-ai-bridge-apply-update
  install -m 0755 "${APP_DIR}/scripts/lxc-image-update.sh" \
    /usr/local/sbin/roon-ai-bridge-image-update

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
  [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} no es una copia de Git válida."

  install -d -m 0755 "${APP_DIR}/data"
  cd "${APP_DIR}"

  log "Actualizando los archivos de instalación desde GitHub"
  update_status downloading "Descargando la información de la nueva versión"
  git fetch origin "${GIT_REF}"
  git checkout "${GIT_REF}"
  git pull --ff-only origin "${GIT_REF}"

  log "Instalando el actualizador del sistema"
  install_update_watcher

  exec env APP_DIR="${APP_DIR}" GIT_REF="${GIT_REF}" STATUS_PATH="${STATUS_PATH}" \
    /usr/local/sbin/roon-ai-bridge-image-update
}

main "$@"
