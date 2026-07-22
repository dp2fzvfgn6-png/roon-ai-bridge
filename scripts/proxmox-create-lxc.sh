#!/usr/bin/env bash
set -Eeuo pipefail

trap 'rc=$?; printf "\nERROR: Installer failed at line %s while running: %s\n" "$LINENO" "$BASH_COMMAND" >&2; exit "$rc"' ERR

APP_NAME="roon-ai-bridge"
DEFAULT_REPO_URL="https://github.com/LINEdev-ipc/roon-ai-bridge.git"

DEFAULT_HOSTNAME="roon-ai-bridge"
DEFAULT_TEMPLATE=""
DEFAULT_TEMPLATE_STORAGE="local"
DEFAULT_ROOTFS_STORAGE="local-lvm"
DEFAULT_ROOTFS_SIZE="8"
DEFAULT_MEMORY="1024"
DEFAULT_SWAP="512"
DEFAULT_CORES="1"
DEFAULT_BRIDGE="vmbr30"
DEFAULT_VLAN_TAG="60"
DEFAULT_FIREWALL="1"
DEFAULT_IP_CIDR="dhcp"
DEFAULT_GATEWAY=""
DEFAULT_DNS=""
DEFAULT_PORT="3000"
DEFAULT_GIT_REF="main"
DEFAULT_START_ON_BOOT="1"
DEFAULT_PRIVILEGED="1"

VMID="${VMID:-}"
HOSTNAME="${LXC_HOSTNAME:-${CT_HOSTNAME:-${HOSTNAME:-}}}"
if [[ "${HOSTNAME}" == "$(hostname -s 2>/dev/null || true)" || "${HOSTNAME}" == "$(hostname 2>/dev/null || true)" ]]; then
  HOSTNAME=""
fi
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
TEMPLATE="${TEMPLATE:-}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-}"
ROOTFS_SIZE="${ROOTFS_SIZE:-}"
MEMORY="${MEMORY:-}"
SWAP="${SWAP:-}"
CORES="${CORES:-}"
BRIDGE="${BRIDGE:-}"
VLAN_TAG="${VLAN_TAG:-}"
FIREWALL="${FIREWALL:-}"
IP_CIDR="${IP_CIDR:-}"
GATEWAY="${GATEWAY:-}"
DNS="${DNS:-}"
PASSWORD="${PASSWORD:-}"
REPO_URL="${REPO_URL:-}"
GIT_REF="${GIT_REF:-}"
PORT="${PORT:-}"
ROON_EXTENSION_NAME="${ROON_EXTENSION_NAME:-}"
ROON_EXTENSION_ID="${ROON_EXTENSION_ID:-}"
START_ON_BOOT="${START_ON_BOOT:-}"
PRIVILEGED="${PRIVILEGED:-}"
INTERACTIVE="${INTERACTIVE:-1}"

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

has_tty() {
  [[ "${INTERACTIVE}" == "1" && -r /dev/tty ]]
}

prompt_default() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local display_value="${4:-$default_value}"
  local current_value="${!var_name:-}"
  local answer=""

  if [[ -n "${current_value}" ]]; then
    return
  fi

  if has_tty; then
    printf '%s [%s]: ' "${label}" "${display_value}" > /dev/tty
    IFS= read -r answer < /dev/tty || true
    printf -v "${var_name}" '%s' "${answer:-$default_value}"
  else
    printf -v "${var_name}" '%s' "${default_value}"
  fi
}

prompt_choice() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local display_value="${4:-$default_value}"
  shift 4
  local options=("$@")
  local current_value="${!var_name:-}"
  local answer=""
  local option=""
  local i=0

  if [[ -n "${current_value}" ]]; then
    return
  fi

  if ! has_tty || [[ "${#options[@]}" -eq 0 ]]; then
    printf -v "${var_name}" '%s' "${default_value}"
    return
  fi

  printf '\n%s\n' "${label}" > /dev/tty
  for i in "${!options[@]}"; do
    option="${options[$i]}"
    if [[ -n "${default_value}" && "${option}" == "${default_value}" ]]; then
      printf '  %s) %s (default)\n' "$((i + 1))" "${option}" > /dev/tty
    else
      printf '  %s) %s\n' "$((i + 1))" "${option}" > /dev/tty
    fi
  done
  printf 'Select number, type custom value, or press Enter [%s]: ' "${display_value}" > /dev/tty
  IFS= read -r answer < /dev/tty || true

  if [[ -z "${answer}" ]]; then
    printf -v "${var_name}" '%s' "${default_value}"
  elif [[ "${answer}" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#options[@]} )); then
    printf -v "${var_name}" '%s' "${options[$((answer - 1))]}"
  else
    printf -v "${var_name}" '%s' "${answer}"
  fi
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run this script as root on the Proxmox host."
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

find_next_vmid() {
  pvesh get /cluster/nextid 2>/dev/null || true
}

prompt_vmid() {
  local suggested_vmid="$1"
  local answer=""

  if [[ -n "${VMID}" ]]; then
    return
  fi

  if has_tty; then
    printf 'LXC VMID [%s]: ' "${suggested_vmid:-230}" > /dev/tty
    IFS= read -r answer < /dev/tty || true
    VMID="${answer:-${suggested_vmid:-230}}"
  else
    VMID="${suggested_vmid:-230}"
  fi
}

read_list() {
  local command_text="$1"
  local output=""
  output="$(bash -lc "${command_text}" 2>/dev/null || true)"
  [[ -n "${output}" ]] || return 0
  mapfile -t REPLY_LIST <<< "${output}"
}

list_template_storages() {
  REPLY_LIST=()
  read_list "pvesm status -content vztmpl | awk 'NR > 1 {print \$1}' | sort -u"
}

list_rootfs_storages() {
  REPLY_LIST=()
  read_list "pvesm status -content rootdir | awk 'NR > 1 {print \$1}' | sort -u"
}

list_network_bridges() {
  REPLY_LIST=()
  read_list "ip -o link show | awk -F': ' '{print \$2}' | cut -d@ -f1 | grep -E '^vmbr[0-9]+' | sort -V"
}

list_debian_templates() {
  REPLY_LIST=()
  read_list "pveam available --section system | awk '/debian-12-standard_.*_amd64\\.tar\\.zst/ {print \$2}' | sort -V"
}

normalize_rootfs_size() {
  local raw="$1"
  raw="${raw//[[:space:]]/}"
  raw="${raw%GiB}"
  raw="${raw%gib}"
  raw="${raw%GB}"
  raw="${raw%gb}"
  raw="${raw%G}"
  raw="${raw%g}"

  [[ "${raw}" =~ ^[0-9]+$ ]] || die "Root filesystem size must be a whole number of GB, for example 8."
  printf '%s' "${raw}"
}

collect_config() {
  local detected_options=()
  local suggested_vmid=""

  suggested_vmid="${VMID:-$(find_next_vmid)}"
  prompt_vmid "${suggested_vmid}"

  prompt_default HOSTNAME "Hostname" "${DEFAULT_HOSTNAME}"

  list_template_storages
  detected_options=("${REPLY_LIST[@]}")
  prompt_choice TEMPLATE_STORAGE "Template storage options:" "${DEFAULT_TEMPLATE_STORAGE}" "${DEFAULT_TEMPLATE_STORAGE}" "${detected_options[@]}"

  if has_tty && [[ -z "${TEMPLATE}" ]]; then
    log "Refreshing Proxmox template catalog"
    pveam update
  fi
  list_debian_templates
  detected_options=("${REPLY_LIST[@]}")
  prompt_choice TEMPLATE "Debian 12 template options:" "${DEFAULT_TEMPLATE}" "latest Debian 12" "${detected_options[@]}"

  list_rootfs_storages
  detected_options=("${REPLY_LIST[@]}")
  prompt_choice ROOTFS_STORAGE "Root filesystem storage options:" "${DEFAULT_ROOTFS_STORAGE}" "${DEFAULT_ROOTFS_STORAGE}" "${detected_options[@]}"

  prompt_default ROOTFS_SIZE "Root filesystem size in GB" "${DEFAULT_ROOTFS_SIZE}"
  prompt_default MEMORY "Memory MB" "${DEFAULT_MEMORY}"
  prompt_default SWAP "Swap MB" "${DEFAULT_SWAP}"
  prompt_default CORES "CPU cores" "${DEFAULT_CORES}"

  list_network_bridges
  detected_options=("${REPLY_LIST[@]}")
  prompt_choice BRIDGE "Network bridge options:" "${DEFAULT_BRIDGE}" "${DEFAULT_BRIDGE}" "${detected_options[@]}"

  prompt_default VLAN_TAG "VLAN tag, empty = none" "${DEFAULT_VLAN_TAG}"
  prompt_default FIREWALL "Enable Proxmox firewall on net0, 1/0" "${DEFAULT_FIREWALL}"
  prompt_default IP_CIDR "IPv4 CIDR or dhcp" "${DEFAULT_IP_CIDR}"

  if [[ "${IP_CIDR}" != "dhcp" ]]; then
    prompt_default GATEWAY "IPv4 gateway" "${DEFAULT_GATEWAY}"
  else
    GATEWAY="${GATEWAY:-}"
  fi

  prompt_default DNS "DNS server" "${DEFAULT_DNS}" "DHCP/default"
  prompt_default REPO_URL "Git repository URL" "${DEFAULT_REPO_URL}"
  prompt_default GIT_REF "Git branch/tag" "${DEFAULT_GIT_REF}"
  prompt_default PORT "HTTP port" "${DEFAULT_PORT}"
  prompt_default ROON_EXTENSION_NAME "Roon extension name" "RoonIA"
  prompt_default ROON_EXTENSION_ID "Roon extension ID" "com.local.roon-ai-bridge"
  prompt_default START_ON_BOOT "Start LXC on Proxmox boot, 1/0" "${DEFAULT_START_ON_BOOT}"
  prompt_default PRIVILEGED "Privileged LXC for Docker, 1/0" "${DEFAULT_PRIVILEGED}"

  [[ -n "${VMID}" ]] || die "VMID is required."
  [[ -n "${BRIDGE}" ]] || die "Bridge is required."
  [[ "${IP_CIDR}" == "dhcp" || -n "${GATEWAY}" ]] || die "Gateway is required when using a static IP."
}

ensure_vmid() {
  if pct status "${VMID}" >/dev/null 2>&1; then
    die "A CT/VM with VMID=${VMID} already exists."
  fi
  return 0
}

print_config_summary() {
  log "Installer configuration"
  printf '  VMID:             %s\n' "${VMID}"
  printf '  Hostname:         %s\n' "${HOSTNAME}"
  printf '  Template storage: %s\n' "${TEMPLATE_STORAGE}"
  printf '  Template:         %s\n' "${TEMPLATE:-latest Debian 12}"
  printf '  Rootfs storage:   %s\n' "${ROOTFS_STORAGE}"
  printf '  Rootfs size:      %s\n' "${ROOTFS_SIZE}"
  printf '  Memory MB:        %s\n' "${MEMORY}"
  printf '  Swap MB:          %s\n' "${SWAP}"
  printf '  CPU cores:        %s\n' "${CORES}"
  printf '  Bridge:           %s\n' "${BRIDGE}"
  printf '  VLAN tag:         %s\n' "${VLAN_TAG:-none}"
  printf '  Firewall net0:    %s\n' "${FIREWALL}"
  printf '  IPv4:             %s\n' "${IP_CIDR}"
  printf '  Gateway:          %s\n' "${GATEWAY:-none}"
  printf '  DNS:              %s\n' "${DNS:-DHCP/default}"
  printf '  Repo:             %s\n' "${REPO_URL}"
  printf '  Git ref:          %s\n' "${GIT_REF}"
  printf '  HTTP port:        %s\n' "${PORT}"
}

resolve_template() {
  if [[ -n "${TEMPLATE}" ]]; then
    return
  fi

  log "Finding latest Debian 12 LXC template"
  pveam update
  TEMPLATE="$(
    pveam available --section system |
      awk '/debian-12-standard_.*_amd64\.tar\.zst/ {print $2}' |
      sort -V |
      tail -n 1
  )"

  [[ -n "${TEMPLATE}" ]] || die "Could not find a Debian 12 template. Set TEMPLATE=debian-12-standard_...tar.zst"
  log "Selected template: ${TEMPLATE}"
}

ensure_template() {
  local template_path="/var/lib/vz/template/cache/${TEMPLATE}"

  if [[ -f "${template_path}" ]]; then
    log "Template found: ${template_path}"
    return
  fi

  log "Downloading template ${TEMPLATE} into storage ${TEMPLATE_STORAGE}"
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

  if [[ "${FIREWALL}" == "1" || "${FIREWALL,,}" == "true" || "${FIREWALL,,}" == "yes" ]]; then
    config="${config},firewall=1"
  fi

  printf '%s' "${config}"
}

create_lxc() {
  local template_ref="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
  local rootfs_size_gb
  local rootfs_ref
  local net0
  local create_args=()

  rootfs_size_gb="$(normalize_rootfs_size "${ROOTFS_SIZE}")"
  rootfs_ref="${ROOTFS_STORAGE}:${rootfs_size_gb}"
  net0="$(network_config)"

  if [[ -z "${PASSWORD}" ]]; then
    PASSWORD="$(openssl rand -base64 24)"
    log "PASSWORD not set; generated a random root password for the CT."
  fi

  log "Creating LXC ${VMID} (${HOSTNAME})"
  create_args=(
    create "${VMID}" "${template_ref}"
    --hostname "${HOSTNAME}"
    --cores "${CORES}"
    --memory "${MEMORY}"
    --swap "${SWAP}"
    --rootfs "${rootfs_ref}"
    --net0 "${net0}"
    --features "nesting=1,keyctl=1"
    --unprivileged "$([[ "${PRIVILEGED}" == "1" ]] && echo 0 || echo 1)"
    --onboot "${START_ON_BOOT}"
    --password "${PASSWORD}"
    --ostype debian
  )

  if [[ -n "${DNS}" ]]; then
    create_args+=(--nameserver "${DNS}")
  fi

  pct "${create_args[@]}"
}

run_in_lxc() {
  pct exec "${VMID}" -- bash -lc "$1"
}

start_lxc() {
  log "Starting LXC ${VMID}"
  pct start "${VMID}"

  log "Waiting for network inside LXC"
  for _ in $(seq 1 60); do
    if run_in_lxc "getent hosts deb.debian.org >/dev/null 2>&1 || ping -c1 -W1 1.1.1.1 >/dev/null 2>&1"; then
      return
    fi
    sleep 2
  done

  die "The LXC started, but network does not seem ready."
}

install_docker_in_lxc() {
  log "Installing Docker and Docker Compose inside LXC"
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
  local image_channel="stable"
  [[ "${GIT_REF}" == "beta" ]] && image_channel="beta"

  log "Deploying ${APP_NAME} from ${REPO_URL} (${GIT_REF})"
  run_in_lxc "
    set -Eeuo pipefail
    rm -rf /opt/${APP_NAME}
    git clone --depth 1 --branch '${GIT_REF}' --filter=blob:none --no-checkout \
      '${REPO_URL}' /opt/${APP_NAME}
    cd /opt/${APP_NAME}
    git sparse-checkout init --no-cone
    git sparse-checkout set '/docker-compose.yml' '/.env.example' '/scripts/'
    git checkout '${GIT_REF}'
    mkdir -p data
    cat > .env <<EOF
PORT=${PORT}
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=${ROON_EXTENSION_NAME}
ROON_EXTENSION_ID=${ROON_EXTENSION_ID}
DATA_DIR=/app/data
ENABLE_BROWSE=true
ENABLE_MCP=false
ENABLE_AUTH=false
API_TOKEN=
ROONIA_IMAGE_TAG=${image_channel}
INSTALLED_CHANNEL=${image_channel}
EOF
    GIT_REF='${GIT_REF}' bash scripts/lxc-update-app.sh
  "
}

print_summary() {
  local ip
  ip="$(pct exec "${VMID}" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"

  log "Installation finished"
  printf '\n'
  printf 'LXC VMID:      %s\n' "${VMID}"
  printf 'Hostname:      %s\n' "${HOSTNAME}"
  printf 'Bridge/VLAN:   %s / %s\n' "${BRIDGE}" "${VLAN_TAG:-none}"
  printf 'Firewall net0: %s\n' "${FIREWALL}"
  printf 'IP detected:   %s\n' "${ip:-unknown}"
  printf 'API health:    http://%s:%s/health\n' "${ip:-LXC_IP}" "${PORT}"
  printf '\n'
  printf 'Next steps:\n'
  printf '1. Open Roon: Settings > Setup > Extensions > RoonIA > Enable\n'
  printf '2. Logs: pct exec %s -- bash -lc "cd /opt/%s && docker compose logs -f"\n' "${VMID}" "${APP_NAME}"
  printf '3. Test: curl http://%s:%s/roon/status\n' "${ip:-LXC_IP}" "${PORT}"
  printf '\n'
}

main() {
  require_root
  require_command pct
  require_command pveam
  require_command pvesh
  require_command pvesm
  require_command openssl

  collect_config
  print_config_summary
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
