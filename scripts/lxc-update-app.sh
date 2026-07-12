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
  cat >/usr/local/sbin/roon-ai-bridge-apply-update <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/run/lock/roon-ai-bridge-update.lock
flock -n 9 || exit 0
REQUEST_PATH='${request_path}'
STATUS_PATH='${status_path}'
[[ -f "\${REQUEST_PATH}" ]] || exit 0
TARGET="\$(sed -n 's/.*\"target\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' "\${REQUEST_PATH}" | head -n1)"
TARGET="\${TARGET:-main}"
if [[ "\${TARGET}" != "main" && "\${TARGET}" != "beta" ]]; then
  rm -f "\${REQUEST_PATH}"
  printf '{"state":"failed","error":"invalid_target","target":"%s","completed_at":"%s"}\\n' "\${TARGET}" "\$(date -Is)" >"\${STATUS_PATH}"
  exit 2
fi
rm -f "\${REQUEST_PATH}"
printf '{"state":"queued","message":"Preparando la actualización","target":"%s","started_at":"%s"}\\n' "\${TARGET}" "\$(date -Is)" >"\${STATUS_PATH}"
if GIT_REF="\${TARGET}" STATUS_PATH="\${STATUS_PATH}" bash '${APP_DIR}/scripts/lxc-update-app.sh'; then
  VERSION="\$(node -p \"require('${APP_DIR}/package.json').version\" 2>/dev/null || printf unknown)"
  BUILD="\$(git -C '${APP_DIR}' rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
  printf '{"state":"completed","message":"Actualización completada y portal operativo","target":"%s","version":"%s","build":"%s","completed_at":"%s"}\\n' "\${TARGET}" "\${VERSION}" "\${BUILD}" "\$(date -Is)" >"\${STATUS_PATH}"
else
  rc=\$?
  printf '{"state":"failed","target":"%s","completed_at":"%s","exit_code":%s}\\n' "\${TARGET}" "\$(date -Is)" "\${rc}" >"\${STATUS_PATH}"
  exit "\${rc}"
fi
EOF
  chmod 0755 /usr/local/sbin/roon-ai-bridge-apply-update

  cat >/etc/systemd/system/roon-ai-bridge-update.service <<EOF
[Unit]
Description=Apply a requested Roon AI Bridge update
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
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
  update_status restarting "Reiniciando el bridge y el portal"
  GIT_COMMIT="${BUILD_COMMIT}" docker compose up -d --build

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
