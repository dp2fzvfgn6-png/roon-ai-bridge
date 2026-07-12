#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
REQUEST_PATH="${APP_DIR}/data/update-request.json"
STATUS_PATH="${APP_DIR}/data/update-status.json"

exec 9>/run/lock/roon-ai-bridge-update.lock
flock -n 9 || exit 0
[[ -f "${REQUEST_PATH}" ]] || exit 0

TARGET="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REQUEST_PATH}" | head -n1)"
TARGET="${TARGET:-main}"
if [[ "${TARGET}" != "main" && "${TARGET}" != "beta" ]]; then
  rm -f "${REQUEST_PATH}"
  printf '{"state":"failed","message":"Canal de actualización no válido","error":"invalid_target","target":"%s","completed_at":"%s"}\n' \
    "${TARGET}" "$(date -Is)" >"${STATUS_PATH}"
  exit 2
fi

rm -f "${REQUEST_PATH}"
printf '{"state":"queued","message":"Preparando la actualización","target":"%s","started_at":"%s"}\n' \
  "${TARGET}" "$(date -Is)" >"${STATUS_PATH}"

if GIT_REF="${TARGET}" STATUS_PATH="${STATUS_PATH}" bash "${APP_DIR}/scripts/lxc-update-app.sh"; then
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${APP_DIR}/package.json" | head -n1)"
  BUILD="$(git -C "${APP_DIR}" rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
  printf '{"state":"completed","message":"Actualización completada y portal operativo","target":"%s","version":"%s","build":"%s","completed_at":"%s"}\n' \
    "${TARGET}" "${VERSION:-unknown}" "${BUILD}" "$(date -Is)" >"${STATUS_PATH}"
else
  rc=$?
  printf '{"state":"failed","message":"La actualización no se pudo completar","target":"%s","completed_at":"%s","exit_code":%s}\n' \
    "${TARGET}" "$(date -Is)" "${rc}" >"${STATUS_PATH}"
  exit "${rc}"
fi
