# Proxmox LXC Install

Run the installer from the Proxmox host shell as `root`.

The installer:

- Creates a Debian 12 LXC.
- Enables `nesting=1,keyctl=1`.
- Uses a privileged LXC by default to simplify Docker-in-LXC.
- Installs Docker and Docker Compose.
- Downloads only the repository deployment files into `/opt/roon-ai-bridge`.
- Creates `.env`.
- Pulls and starts the ready-to-run GHCR image without compiling in the LXC.
- Installs the portal update watcher, backup and automatic rollback flow.

## Network Defaults

The defaults match the Roon VM network shown in the setup:

```text
Bridge: vmbr30
VLAN Tag: 60
Firewall: enabled
IP: dhcp
```

When the installer asks a question, press Enter to accept the default. When Proxmox can detect available options, the installer shows numbered choices for:

- Template storage
- Debian template
- Root filesystem storage
- Network bridge

For those questions, select a number, type a custom value or press Enter for the default.

## Interactive Install

```bash
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
```

## DHCP Install Without Prompts

```bash
INTERACTIVE=0 \
VMID=230 \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
REPO_URL=https://github.com/LINEdev-ipc/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
```

## Static IP Install Without Prompts

Adjust the IP and gateway to your VLAN 60 subnet:

```bash
INTERACTIVE=0 \
VMID=230 \
LXC_HOSTNAME=roon-ai-bridge \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
IP_CIDR=192.168.60.50/24 \
GATEWAY=192.168.60.1 \
REPO_URL=https://github.com/LINEdev-ipc/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
```

## Installer Variables

- `VMID`: LXC ID. If empty, the script tries to use the next available ID.
- `LXC_HOSTNAME` or `CT_HOSTNAME`: default `roon-ai-bridge`.
- `TEMPLATE_STORAGE`: default `local`.
- `TEMPLATE`: empty by default, auto-detects latest Debian 12 template.
- `ROOTFS_STORAGE`: default `local-lvm`.
- `ROOTFS_SIZE`: default `8`, in GB. Values like `8G` are accepted and normalized.
- `MEMORY`: default `1024`.
- `SWAP`: default `512`.
- `CORES`: default `1`.
- `BRIDGE`: default `vmbr30`.
- `VLAN_TAG`: default `60`; leave empty if you do not use VLAN.
- `FIREWALL`: default `1`.
- `IP_CIDR`: default `dhcp`.
- `GATEWAY`: required only when using a static IP.
- `DNS`: empty by default; leave empty to use DHCP/default DNS.
- `REPO_URL`: default `https://github.com/LINEdev-ipc/roon-ai-bridge.git`.
- `GIT_REF`: default `main`.
- `GIT_REF=beta` installs and follows the beta image channel.
- `PORT`: default `3000`.
- `PRIVILEGED`: default `1`.
- `INTERACTIVE`: default `1`; set to `0` to accept defaults/non-interactive values.

## After Install

Authorize the extension in Roon:

```text
Settings > Setup > Extensions > Roon AI Bridge
```

Then test:

```bash
curl http://<LXC_IP>:3000/health
curl http://<LXC_IP>:3000/roon/status
curl http://<LXC_IP>:3000/roon/zones
```

The public container package must be available before a new installation. See
the one-time GHCR visibility note in [Update Existing LXC](update-lxc.md).
