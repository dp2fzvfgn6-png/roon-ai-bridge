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

main() {
  require_command git
  require_command docker

  [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout."

  log "Updating ${APP_DIR} from GitHub"
  cd "${APP_DIR}"

  git fetch origin "${GIT_REF}"
  git checkout "${GIT_REF}"
  git pull --ff-only origin "${GIT_REF}"

  log "Rebuilding and restarting Docker Compose service"
  docker compose up -d --build

  log "Update finished"
  docker compose ps
}

main "$@"
