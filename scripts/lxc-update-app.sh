#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
GIT_REF="${GIT_REF:-main}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
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
TARGET="\$(node -e 'try{const fs=require("fs");const req=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const target=String(req.target||"main");if(!["main","beta"].includes(target)) process.exit(2);process.stdout.write(target)}catch{process.exit(1)}' "\${REQUEST_PATH}")"
rm -f "\${REQUEST_PATH}"
printf '{"state":"running","target":"%s","started_at":"%s"}\\n' "\${TARGET}" "\$(date -Is)" >"\${STATUS_PATH}"
if GIT_REF="\${TARGET}" bash '${APP_DIR}/scripts/lxc-update-app.sh'; then
  printf '{"state":"completed","target":"%s","completed_at":"%s"}\\n' "\${TARGET}" "\$(date -Is)" >"\${STATUS_PATH}"
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
  systemctl enable --now roon-ai-bridge-update.path
}

main() {
  require_command git
  require_command docker

  [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout."

  log "Updating ${APP_DIR} from GitHub"
  cd "${APP_DIR}"

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
  docker compose up -d --build

  log "Update finished"
  docker compose ps
}

main "$@"
