#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="roon-ai-bridge"
DEFAULT_HOSTNAME="roon-ai-bridge"
DEFAULT_TEMPLATE=""
DEFAULT_TEMPLATE_STORAGE="local"
DEFAULT_ROOTFS_STORAGE="local-lvm"
DEFAULT_ROOTFS_SIZE="8G"
DEFAULT_MEMORY="1024"
DEFAULT_SWAP="512"
DEFAULT_CORES="1"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_PORT="3000"

VMID="${VMID:-}"
HOSTNAME="${HOSTNAME:-$DEFAULT_HOSTNAME}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$DEFAULT_TEMPLATE_STORAGE}"
TEMPLATE="${TEMPLATE:-$DEFAULT_TEMPLATE}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-$DEFAULT_ROOTFS_STORAGE}"
ROOTFS_SIZE="${ROOTFS_SIZE:-$DEFAULT_ROOTFS_SIZE}"
MEMORY="${MEMORY:-$DEFAULT_MEMORY}"
SWAP="${SWAP:-$DEFAULT_SWAP}"
CORES="${CORES:-$DEFAULT_CORES}"
BRIDGE="${BRIDGE:-$DEFAULT_BRIDGE}"
VLAN_TAG="${VLAN_TAG:-}"
IP_CIDR="${IP_CIDR:-dhcp}"
GATEWAY="${GATEWAY:-}"
DNS="${DNS:-1.1.1.1}"
PASSWORD="${PASSWORD:-}"
REPO_URL="${REPO_URL:-}"
GIT_REF="${GIT_REF:-main}"
PORT="${PORT:-$DEFAULT_PORT}"
ROON_EXTENSION_NAME="${ROON_EXTENSION_NAME:-Roon AI Bridge}"
ROON_EXTENSION_ID="${ROON_EXTENSION_ID:-com.linestudio.roon-ai-bridge}"
START_ON_BOOT="${START_ON_BOOT:-1}"
PRIVILEGED="${PRIVILEGED:-1}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Ejecuta este script como root en el host Proxmox."
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "No encuentro el comando requerido: $1"
}

find_next_vmid() {
  pvesh get /cluster/nextid 2>/dev/null || true
}

ensure_vmid() {
  if [[ -z "${VMID}" ]]; then
    VMID="$(find_next_vmid)"
  fi

  [[ -n "${VMID}" ]] || die "No se pudo calcular VMID. Define VMID=123."
  pct status "${VMID}" >/dev/null 2>&1 && die "Ya existe un CT/VM con VMID=${VMID}."
}

resolve_template() {
  if [[ -n "${TEMPLATE}" ]]; then
    return
  fi

  log "Buscando ultimo template Debian 12 disponible"
  pveam update
  TEMPLATE="$(
    pveam available --section system |
      awk '/debian-12-standard_.*_amd64\.tar\.zst/ {print $2}' |
      sort -V |
      tail -n 1
  )"

  [[ -n "${TEMPLATE}" ]] || die "No se encontro template Debian 12. Define TEMPLATE=debian-12-standard_...tar.zst"
  log "Template seleccionado: ${TEMPLATE}"
}

ensure_template() {
  local template_path="/var/lib/vz/template/cache/${TEMPLATE}"

  if [[ -f "${template_path}" ]]; then
    log "Template encontrado: ${template_path}"
    return
  fi

  log "Descargando template ${TEMPLATE} en storage ${TEMPLATE_STORAGE}"
  pveam update
  pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}"
}

network_config() {
  local config="name=eth0,bridge=${BRIDGE},ip=${IP_CIDR}"

  if [[ -n "${GATEWAY}" && "${IP_CIDR}" != "dhcp" ]]; then
    config="${config},gw=${GATEWAY}"
  fi

  if [[ -n "${VLAN_TAG}" ]]; then
    config="${config},tag=${VLAN_TAG}"
  fi

  printf '%s' "${config}"
}

create_lxc() {
  local template_ref="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
  local rootfs_ref="${ROOTFS_STORAGE}:${ROOTFS_SIZE}"
  local net0
  net0="$(network_config)"

  if [[ -z "${PASSWORD}" ]]; then
    PASSWORD="$(openssl rand -base64 24)"
    log "PASSWORD no definido; generado password root aleatorio para el CT."
  fi

  log "Creando LXC ${VMID} (${HOSTNAME})"
  pct create "${VMID}" "${template_ref}" \
    --hostname "${HOSTNAME}" \
    --cores "${CORES}" \
    --memory "${MEMORY}" \
    --swap "${SWAP}" \
    --rootfs "${rootfs_ref}" \
    --net0 "${net0}" \
    --nameserver "${DNS}" \
    --features "nesting=1,keyctl=1" \
    --unprivileged "$([[ "${PRIVILEGED}" == "1" ]] && echo 0 || echo 1)" \
    --onboot "${START_ON_BOOT}" \
    --password "${PASSWORD}" \
    --ostype debian
}

run_in_lxc() {
  pct exec "${VMID}" -- bash -lc "$1"
}

start_lxc() {
  log "Arrancando LXC ${VMID}"
  pct start "${VMID}"

  log "Esperando red dentro del LXC"
  for _ in $(seq 1 60); do
    if run_in_lxc "getent hosts deb.debian.org >/dev/null 2>&1 || ping -c1 -W1 1.1.1.1 >/dev/null 2>&1"; then
      return
    fi
    sleep 2
  done

  die "El LXC arrancó, pero no parece tener red."
}

install_docker_in_lxc() {
  log "Instalando Docker y Docker Compose dentro del LXC"
  run_in_lxc '
    set -Eeuo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl git gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    docker --version
    docker compose version
  '
}

deploy_app() {
  if [[ -z "${REPO_URL}" ]]; then
    log "REPO_URL no definido. Se deja el LXC listo con Docker, pero sin clonar la app."
    log "Cuando tengas el repo remoto, ejecuta dentro del LXC:"
    log "  git clone <URL> /opt/${APP_NAME} && cd /opt/${APP_NAME} && cp .env.example .env && docker compose up -d --build"
    return
  fi

  log "Desplegando ${APP_NAME} desde ${REPO_URL} (${GIT_REF})"
  run_in_lxc "
    set -Eeuo pipefail
    rm -rf /opt/${APP_NAME}
    git clone --branch '${GIT_REF}' '${REPO_URL}' /opt/${APP_NAME}
    cd /opt/${APP_NAME}
    mkdir -p data
    cat > .env <<EOF
PORT=${PORT}
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=${ROON_EXTENSION_NAME}
ROON_EXTENSION_ID=${ROON_EXTENSION_ID}
DATA_DIR=/app/data
ENABLE_BROWSE=false
ENABLE_MCP=false
ENABLE_AUTH=false
EOF
    docker compose up -d --build
  "
}

print_summary() {
  local ip
  ip="$(pct exec "${VMID}" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"

  log "Instalación terminada"
  printf '\n'
  printf 'LXC VMID:      %s\n' "${VMID}"
  printf 'Hostname:      %s\n' "${HOSTNAME}"
  printf 'IP detectada:  %s\n' "${ip:-desconocida}"
  printf 'API health:    http://%s:%s/health\n' "${ip:-IP_DEL_LXC}" "${PORT}"
  printf '\n'
  printf 'Siguientes pasos:\n'
  printf '1. Abre Roon: Settings > Setup > Extensions > Roon AI Bridge > Enable\n'
  printf '2. Mira logs: pct exec %s -- bash -lc "cd /opt/%s && docker compose logs -f"\n' "${VMID}" "${APP_NAME}"
  printf '3. Prueba: curl http://%s:%s/roon/status\n' "${ip:-IP_DEL_LXC}" "${PORT}"
  printf '\n'
}

main() {
  require_root
  require_command pct
  require_command pveam
  require_command pvesh
  require_command openssl

  ensure_vmid
  resolve_template
  ensure_template
  create_lxc
  start_lxc
  install_docker_in_lxc
  deploy_app
  print_summary
}

main "$@"
