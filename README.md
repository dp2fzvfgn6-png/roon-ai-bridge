# Roon AI Bridge

Local Roon extension with a small HTTP API in Node.js. v0.1 is intentionally limited to validating that a separate Proxmox LXC, in the same VLAN/subnet as Roon Core, can register and authorize an extension, list zones, read now playing, control playback and control volume when Roon allows it.

This project does not expose anything to the internet. v0.1 does not implement auth, MCP, OpenAI, ChatGPT, Cloudflare, direct TIDAL access, playlists or advanced search.

## Architecture

The project is structured so v0.1 stays small but can grow without a rewrite.

```text
src/
  index.ts
  config/          environment and app configuration
  roon/            Roon client, types and Roon services
  api/             Express server and HTTP routes
  services/        future application services
  db/              future persistence adapter
  mcp/             future MCP notes and stubs
  security/        future security notes
  utils/           logger, errors and validation
db/
  schema.sql       planned SQLite schema
data/
  roonstate.json   runtime Roon authorization state
```

v0.1 uses `node-roon-api` and `node-roon-api-transport`. `node-roon-api-browse` is reserved for v0.2.

## v0.1 Scope

- Register the Roon extension.
- Authorize it from `Settings > Setup > Extensions`.
- Connect and reconnect to Roon Core on the LAN.
- List zones.
- Show basic now playing.
- Control `play`, `pause`, `playpause`, `stop`, `next`, `previous`.
- Control relative or absolute volume when the output supports it.
- Expose a local HTTP API on a configurable port.
- Return homogeneous API errors.
- Use centralized logs.

## Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Main values:

```env
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=Roon AI Bridge
ROON_EXTENSION_ID=com.local.roon-ai-bridge
DATA_DIR=/app/data
ENABLE_BROWSE=false
ENABLE_MCP=false
ENABLE_AUTH=false
```

## Proxmox LXC Deployment

There are two paths:

- Automatic installer from the Proxmox host.
- Manual installation inside an existing LXC.

Full documentation lives in [docs/](docs/README.md):

- [Proxmox LXC install](docs/install-proxmox-lxc.md)
- [Update existing LXC](docs/update-lxc.md)
- [Configuration](docs/configuration.md)
- [HTTP API](docs/api.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Roadmap](docs/roadmap.md)

## Automatic Proxmox Installer

The script [scripts/proxmox-create-lxc.sh](scripts/proxmox-create-lxc.sh) is designed to run as `root` on the Proxmox host. It creates the LXC, enables `nesting/keyctl`, installs Docker inside the container, clones this repo and starts the app with Docker Compose.

If you run it without variables, it asks for the configuration and uses defaults when you press Enter. When Proxmox can detect available options, the installer shows numbered choices for template storage, Debian template, root filesystem storage and network bridge. You can select a number, type a custom value or press Enter for the default.

The network defaults match your Roon VM network screenshot:

- Bridge: `vmbr30`
- VLAN Tag: `60`
- Proxmox firewall on net0: enabled
- IP: `dhcp`

Interactive one-liner:

```bash
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=vmid-prompt-fix')"
```

Example with DHCP:

```bash
VMID=230 \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=vmid-prompt-fix')"
```

Example with static IP and VLAN:

```bash
VMID=230 \
LXC_HOSTNAME=roon-ai-bridge \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
IP_CIDR=192.168.60.50/24 \
GATEWAY=192.168.60.1 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=vmid-prompt-fix')"
```

Useful variables:

- `VMID`: LXC ID. If empty, the script tries to use the next available ID.
- `LXC_HOSTNAME` or `CT_HOSTNAME`: default `roon-ai-bridge`.
- `TEMPLATE_STORAGE`: default `local`.
- `TEMPLATE`: empty by default, auto-detects latest Debian 12 template.
- `ROOTFS_STORAGE`: default `local-lvm`.
- `ROOTFS_SIZE`: default `8G`.
- `MEMORY`: default `1024`.
- `SWAP`: default `512`.
- `CORES`: default `1`.
- `BRIDGE`: default `vmbr30`.
- `VLAN_TAG`: default `60`; leave empty if you do not use VLAN.
- `FIREWALL`: default `1`.
- `IP_CIDR`: default `dhcp`.
- `GATEWAY`: required only when using a static IP.
- `DNS`: empty by default; leave empty to use DHCP/default DNS.
- `REPO_URL`: default `https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git`.
- `GIT_REF`: default `main`.
- `PORT`: default `3000`.
- `PRIVILEGED`: default `1`, recommended to simplify Docker inside LXC.

Important: if this GitHub repository is private, `curl` against `raw.githubusercontent.com` needs authentication. For a simple unauthenticated one-liner, the repository must be public, or you must download the script with an authenticated method.

After the installer finishes, authorize the extension in Roon:

```text
Settings > Setup > Extensions > Roon AI Bridge
```

## Updating An Existing LXC

The Proxmox installer is for the Proxmox host. It cannot be reused inside the LXC because it depends on host commands such as `pct`, `pveam` and `pvesh`.

To update the app from inside the LXC, use [scripts/lxc-update-app.sh](scripts/lxc-update-app.sh):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"
```

It runs:

- `git fetch`
- `git pull --ff-only`
- `docker compose up -d --build`

You can also trigger the update from the Proxmox host:

```bash
pct exec 230 -- bash -lc 'bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"'
```

## Manual Installation

1. Create a dedicated Debian/Ubuntu LXC named `roon-ai-bridge`.
2. Put it on the same bridge/VLAN as Roon Core.
3. Make sure the LXC has an IP in the same subnet.
4. Verify connectivity:

```bash
ping <ROON_CORE_IP>
```

## Install Docker And Docker Compose

Debian:

```bash
apt update
apt install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

If the LXC uses Ubuntu, change the Docker URL to `https://download.docker.com/linux/ubuntu`.

## Install The Project

```bash
cd /opt
git clone https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git roon-ai-bridge
cd /opt/roon-ai-bridge
cp .env.example .env
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f
```

Docker Compose uses:

- `network_mode: host`
- `restart: unless-stopped`
- `env_file: .env`
- `./data:/app/data`

## API

Health:

```bash
curl http://localhost:3000/health
```

Status:

```bash
curl http://localhost:3000/roon/status
```

Capabilities:

```bash
curl http://localhost:3000/roon/capabilities
```

Zones:

```bash
curl http://localhost:3000/roon/zones
```

Playback control:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/control \
  -H "Content-Type: application/json" \
  -d '{"command":"playpause"}'
```

Relative volume:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"relative","value":1}'
```

Absolute volume:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"absolute","value":35}'
```

## Prepared 501 Endpoints

These endpoints exist to reserve the architecture, but return `501 Not Implemented` in v0.1:

- `GET /roon/library`
- `GET /roon/search?q=...`
- `POST /roon/play`
- `GET /roon/queue/:zone_id`
- `POST /roon/queue/:zone_id`
- `GET /playlists`
- `POST /playlists`
- `POST /playlists/:playlist_id/play`
- `GET /history`
- `GET /preferences`

Error format:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Search is not implemented in v0.1",
    "details": {}
  }
}
```

## Troubleshooting

If Roon does not show the extension:

- Confirm that the LXC is on the same VLAN/subnet as Roon Core.
- Use `network_mode: host`; Roon discovery depends on local networking.
- Check firewalls on Proxmox, the LXC and the Roon Core VM/LXC.
- Confirm you are not using Docker bridge mode for this service.
- Check logs with `docker compose logs -f`.
- Delete `./data/roonstate.json` only if you want to force a new Roon authorization.

If `/roon/status` says `transport_ready: false`, the extension may still be pending authorization, or Roon has not exposed the transport service yet.

## Roadmap

- v0.1: basic control.
- v0.2: browse/library.
- v0.3: search/play by query.
- v0.4: queue management.
- v0.5: virtual playlists.
- v0.6: MCP server.
- v0.7: auth + Cloudflare Tunnel.
- v0.8: ChatGPT App / final integration.

## Security

This phase is LAN-only. Do not publish port `3000` to the internet and do not put it behind tunnels, public proxies or NAT rules. Authentication is planned for a later phase.
