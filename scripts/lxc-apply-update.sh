#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/roon-ai-bridge}"
REQUEST_PATH="${APP_DIR}/data/update-request.json"
STATUS_PATH="${APP_DIR}/data/update-status.json"
RELEASE_PATH="${APP_DIR}/data/installed-release.json"

exec 9>/run/lock/roon-ai-bridge-update.lock
flock -n 9 || exit 0
[[ -f "${REQUEST_PATH}" ]] || exit 0

CHANNEL="$(sed -n 's/.*"image_tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REQUEST_PATH}" | head -n1)"
LEGACY_TARGET="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REQUEST_PATH}" | head -n1)"

if [[ -z "${CHANNEL}" ]]; then
  [[ "${LEGACY_TARGET:-main}" == "beta" ]] && CHANNEL="beta" || CHANNEL="stable"
fi

case "${CHANNEL}" in
  stable) TARGET="main" ;;
  beta) TARGET="beta" ;;
  *)
    rm -f "${REQUEST_PATH}"
    printf '{"state":"failed","message":"Canal de actualización no válido","error":"invalid_channel","target":"%s","completed_at":"%s"}\n' \
      "${CHANNEL}" "$(date -Is)" >"${STATUS_PATH}"
    exit 2
    ;;
esac

rm -f "${REQUEST_PATH}"
printf '{"state":"queued","message":"Preparando la actualización","target":"%s","started_at":"%s"}\n' \
  "${TARGET}" "$(date -Is)" >"${STATUS_PATH}"

if GIT_REF="${TARGET}" STATUS_PATH="${STATUS_PATH}" bash "${APP_DIR}/scripts/lxc-update-app.sh"; then
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${RELEASE_PATH}" | head -n1)"
  BUILD="$(sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${RELEASE_PATH}" | head -n1)"
  DIGEST="$(sed -n 's/.*"image_digest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${RELEASE_PATH}" | head -n1)"
  printf '{"state":"completed","message":"Actualización completada y portal operativo","target":"%s","version":"%s","build":"%s","image_digest":"%s","completed_at":"%s"}\n' \
    "${TARGET}" "${VERSION:-unknown}" "${BUILD:-unknown}" "${DIGEST:-unknown}" "$(date -Is)" >"${STATUS_PATH}"
else
  rc=$?
  printf '{"state":"failed","message":"La actualización no se pudo completar; se ha recuperado la versión anterior","target":"%s","completed_at":"%s","exit_code":%s}\n' \
    "${TARGET}" "$(date -Is)" "${rc}" >"${STATUS_PATH}"
  exit "${rc}"
fi
