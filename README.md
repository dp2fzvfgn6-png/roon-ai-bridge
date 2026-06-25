# Roon AI Bridge

Local Roon extension with a small HTTP API and optional MCP stdio server in Node.js. v0.7 keeps the validated v0.1 control surface, v0.2 library browse, v0.3 search/play-by-query, v0.4 queue management, v0.5 local virtual playlists, v0.6 local MCP tools, and adds optional Bearer-token authentication for exposing the HTTP API through a reverse proxy.

This project does not expose anything to the internet by itself. v0.7 does not implement OpenAI, ChatGPT, Cloudflare automation, direct TIDAL write access or advanced search ranking.

## Architecture

The project is structured so the current feature set stays small but can grow without a rewrite.

```text
src/
  index.ts
  config/          environment and app configuration
  roon/            Roon client, types and Roon services
  api/             Express server and HTTP routes
  services/        future application services
  db/              future persistence adapter
  mcp/             local MCP stdio server and tool definitions
  security/        future security notes
  utils/           logger, errors and validation
db/
  schema.sql       planned SQLite schema
data/
  roonstate.json   runtime Roon authorization state
```

v0.7 uses `node-roon-api`, `node-roon-api-transport`, `node-roon-api-browse` and `@modelcontextprotocol/sdk`.

## v0.7 Scope

- Register the Roon extension.
- Authorize it from `Settings > Setup > Extensions`.
- Connect and reconnect to Roon Core on the LAN.
- List zones.
- Show basic now playing.
- Control `play`, `pause`, `playpause`, `stop`, `next`, `previous`.
- Control relative or absolute volume when the output supports it.
- Browse the Roon library through `GET /roon/library`.
- Search Roon through `GET /roon/search?q=...`.
- Start playback from a simple query through `POST /roon/play`.
- Read queue snapshots through `GET /roon/queue/:zone_id`.
- Start playback from a queue item with `play_from_here`.
- Add a query result next or to the queue when Roon exposes that browse action.
- Create local virtual playlists.
- Add/remove playlist tracks by stable query.
- Play or enqueue a virtual playlist through Roon.
- Expose local MCP stdio tools for status, zones, playback, volume, search, queue and virtual playlists.
- Optionally protect the HTTP API with `Authorization: Bearer <API_TOKEN>`.
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
ENABLE_BROWSE=true
ENABLE_MCP=false
ENABLE_AUTH=false
API_TOKEN=
```

`ENABLE_MCP` is reserved for runtime signalling. The v0.7 MCP server is launched as a separate stdio process with `npm run mcp`, not as a hosted HTTP endpoint.

For Nginx Proxy Manager or any other reverse proxy, enable HTTP auth first:

```bash
openssl rand -hex 32
```

Then set:

```env
ENABLE_AUTH=true
API_TOKEN=<generated-token>
```

Use the token in API calls:

```bash
curl https://roon.example.com/roon/status \
  -H "Authorization: Bearer <generated-token>"
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
- [v0.1 validation](docs/v0.1-validation.md)
- [v0.2 validation](docs/v0.2-validation.md)
- [v0.3 validation](docs/v0.3-validation.md)
- [v0.4 validation](docs/v0.4-validation.md)
- [v0.5 validation](docs/v0.5-validation.md)
- [v0.6 validation](docs/v0.6-validation.md)
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
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=rootfs-fix')"
```

Example with DHCP:

```bash
VMID=230 \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=rootfs-fix')"
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
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=rootfs-fix')"
```

Useful variables:

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

Library browse:

```bash
curl "http://localhost:3000/roon/library"
curl "http://localhost:3000/roon/library?hierarchy=albums&count=50"
curl "http://localhost:3000/roon/library?item_key=<ITEM_KEY>&zone_id=<ZONE_ID>"
```

Search:

```bash
curl "http://localhost:3000/roon/search?q=massive%20attack&count=10"
```

Play by query:

```bash
curl -X POST http://localhost:3000/roon/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","query":"massive attack mezzanine"}'
```

Queue:

```bash
curl "http://localhost:3000/roon/queue/<ZONE_ID>?max_item_count=50" | python3 -m json.tool

curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"play_from_here","queue_item_id":"<QUEUE_ITEM_ID>"}'

curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_next","query":"bad bunny"}'

curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_to_queue","query":"bad bunny"}'

curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"inspect_actions","query":"bad bunny"}'
```

Virtual playlists:

```bash
curl -X POST http://localhost:3000/playlists \
  -H "Content-Type: application/json" \
  -d '{"playlist_id":"bad-bunny-test","name":"Bad Bunny Test","tracks":[{"query":"bad bunny dakiti"},{"query":"bad bunny neverita"}]}'

curl http://localhost:3000/playlists | python3 -m json.tool

curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"query":"bad bunny monaco"}'

curl -X POST http://localhost:3000/playlists/bad-bunny-test/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","mode":"add_to_queue"}'
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

## MCP Server

v0.6 added a local MCP stdio server. It is intended for trusted local execution, for example from inside the LXC or through an MCP client that can launch a command on that machine.

Build first:

```bash
npm run build
```

Run from `/opt/roon-ai-bridge`:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

Implemented MCP tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_play_virtual_playlist`

Do not expose the MCP process to untrusted clients yet. Auth and remote access are planned for later phases.

## Prepared 501 Endpoints

These endpoints exist to reserve the architecture, but return `501 Not Implemented` in v0.7:

- `GET /history`
- `GET /preferences`

Error format:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "History is not implemented in v0.7",
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

If `/roon/status` says `browse_ready: false`, wait until Roon reconnects the extension after the update and confirm `ENABLE_BROWSE=true` in `/opt/roon-ai-bridge/.env`.

## Roadmap

- v0.1: basic control.
- v0.2: browse/library.
- v0.3: search/play by query.
- v0.4: queue management.
- v0.5: virtual playlists.
- v0.6: MCP server.
- v0.7: HTTP API key auth for reverse proxy use.
- v0.8: ChatGPT App / final integration.

## Security

Do not publish port `3000` directly to the internet. If you expose the HTTP API through Nginx Proxy Manager, enable `ENABLE_AUTH=true`, set a long `API_TOKEN`, use HTTPS, and keep MCP stdio local-only.
