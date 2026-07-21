# Roon AI Bridge

Local Roon extension with HTTP/MCP APIs, focused ChatGPT widgets and a secure
administration portal. The current development package is v0.19.0. It extends the
canonical MCP v2 surface with deterministic media discovery, strict playlist
creation, six cache-busted v19 widgets and a modular internal architecture.

See the [changelog](CHANGELOG.md) and [v0.19.0 validation](docs/v0.19.0-validation.md).

This project does not expose anything to the internet by itself. It does not
implement OpenAI API calls, Cloudflare automation or direct TIDAL write access.

## License

RoonIA is source-available at no charge for personal and other noncommercial
purposes under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial
use is not permitted without prior express written permission. This includes
charging to install, configure, update, maintain or support RoonIA, offering it
as a paid service, or bundling it with a commercial product. See the practical
[commercial-use policy](COMMERCIAL_USE.md) for examples.

Third-party components retain their own licenses. RoonIA is an independent
project and is not affiliated with or endorsed by Roon Labs.

## Architecture

The project is structured so the current feature set stays small but can grow without a rewrite.

```text
src/
  index.ts
  app/             typed application context and dependency composition
  config/          environment and app configuration
  roon/            Roon client, adapters and focused media policies
  api/             Express server and HTTP routes
  portal/          portal server and focused route modules
  services/        application services and focused playlist policies
  db/              SQLite adapter and versioned migrations
  bridge-v2/       active MCP intents, transports and Apps resources
  security/        future security notes
  utils/           logger, errors and validation
portal/
  features/        extracted browser features behind the existing portal shell
data/
  roonstate.json   runtime Roon authorization state
```

v0.19.0 uses Node.js 24, `node-roon-api`, `node-roon-api-transport`,
`node-roon-api-browse`, native `node:sqlite` and
`@modelcontextprotocol/sdk`.

## Current Scope

- Register the Roon extension.
- Authorize it from `Settings > Setup > Extensions`.
- Connect and reconnect to Roon Core on the LAN.
- List zones.
- Group compatible zones while preserving the primary zone queue.
- Fully ungroup a grouped zone into independent outputs.
- Show basic now playing.
- Control `play`, `pause`, `playpause`, `stop`, `next`, `previous`.
- Control relative or absolute volume when the output supports it.
- Browse the Roon library through `GET /roon/library`.
- Return normalized song metadata and cover references in library browse items when Roon exposes them.
- Search Roon through `GET /roon/search?q=...`.
- Start playback from a simple query through `POST /roon/play`.
- Read queue snapshots through `GET /roon/queue/:zone_id`.
- Start playback from a queue item with `play_from_here`.
- Add a query result next or to the queue when Roon exposes that browse action.
- Create local virtual playlists.
- Store local virtual playlists in SQLite.
- Create expiring working playlists for activity, mood and occasion requests,
  then promote a liked result to a normal saved playlist without rebuilding it.
- Create, read, update, delete and reorder playlist tracks by stable identity
  with separately verified recording, release, source and user metadata.
- Refresh coherent playlist metadata from Roon and MusicBrainz without
  silently mixing album editions, artwork or recording versions.
- Play or enqueue a virtual playlist through Roon.
- Expose MCP tools for status, zones, playback, volume, search, queue and virtual playlists.
- Serve an independent administration portal on port `3001`.
- Control playback, volume, queues and synchronized zone groups from the portal.
- Create, edit, reorder, play and delete virtual playlists from the portal.
- Configure temporary-playlist expiry under System and, in Debug mode, inspect,
  edit, play, promote or delete temporary playlists from their own section.
- Generate automatic playlist cover collages from distinct track artwork, with
  instant random tile rotation every two seconds.
- Prepare generated playlist artwork from exact playlist context, transfer the
  resulting ChatGPT file through an authorized file reference and store a
  verified high-resolution square WebP instead of an inline thumbnail.
- Resolve playlist tracks through strict recording identity matching, preferring
  equivalent TIDAL lossless candidates without allowing source quality to hide
  artist or version mismatches.
- Create and revoke hashed, role-based API keys (`read`, `control`, `admin`).
- Configure API/portal ports and operations from Roon extension settings.
- Publish extension status and addresses inside Roon.
- Bootstrap the first portal administrator with username/password.
- Subscribe to outputs and expose seek, mute, global pause, standby and source switching.
- Change shuffle, auto-radio and loop settings.
- Browse the generic Settings hierarchy and handle input prompts and item mutations.
- Render Roon artwork in the portal and ChatGPT widget.
- Save/apply zone grouping presets and per-output volume policies.
- Check GitHub versions and request a host-supervised update.
- Optionally protect the HTTP API with `Authorization: Bearer <API_TOKEN>`.
- Expose remote MCP over `POST /mcp` and `GET /mcp` for ChatGPT app development.
- Register six focused read-only MCP Apps widgets under `ui://roon-ai-bridge/v19/`.
- Publish OAuth discovery metadata and support dynamic client registration.
- Authorize a private ChatGPT app with authorization code, PKCE and a local approval PIN.
- Search tracks, albums, artists and playlists separately.
- Read every ordered track from a selected Roon catalog playlist through
  paginated media details.
- Return temporary `result_id` references for exact follow-up actions.
- Play a selected track, album or artist catalog while replacing the existing queue.
- Start artist radio as a separate similar-music intent.
- Add selected media next or at the end of the queue.
- Return MCP `structuredContent` and output schemas.
- Bind OAuth tokens to the MCP resource and `roon:control` scope.
- Expose `GET /privacy` as a plain text privacy notice for app setup.
- Expose a local HTTP API on a configurable port.
- Return homogeneous API errors.
- Use centralized logs.

## Administration Portal

Open `http://10.0.60.38:3001`. On first access, enter the bootstrap
`PORTAL_ADMIN_TOKEN` (or its `API_TOKEN` fallback) and create the administrator
username/password. Later logins use that account. Passwords and session tokens
are stored only as one-way hashes.

```env
ENABLE_PORTAL=true
PORTAL_PORT=3001
PORTAL_ADMIN_TOKEN=
```

When `PORTAL_ADMIN_TOKEN` is empty, it falls back to `API_TOKEN`.

The portal home prioritizes current multiroom playback, zones and recently
played virtual playlists. Its activity section separates the newest 500 track
starts (including artwork and Roon zone) from the newest 100 portal searches.
Both histories are stored locally in SQLite, load progressively and remain
separate from the technical audit log.

## Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Main values:

```env
PORT=3000
PORTAL_PORT=3001
ENABLE_PORTAL=true
PORTAL_ADMIN_TOKEN=
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=Roon AI Bridge
ROON_EXTENSION_ID=com.local.roon-ai-bridge
DATA_DIR=/app/data
ENABLE_BROWSE=true
ENABLE_MCP=false
ENABLE_AUTH=false
API_TOKEN=
PUBLIC_BASE_URL=https://roonia.ipchome.com
OAUTH_ISSUER=https://roonia.ipchome.com
OAUTH_APPROVAL_PIN=
ROON_STREAMING_SOURCE=TIDAL
```

`ROON_STREAMING_SOURCE` helps classify linked catalog results when Roon does not include an explicit service name. Source and quality remain `unknown` when Roon does not expose enough information.

`ENABLE_MCP` is reserved for runtime signalling. The local stdio MCP process
runs with `npm run mcp`; remote MCP is also exposed at `/mcp` through the main
HTTP server.

`OAUTH_APPROVAL_PIN` is used when authorizing ChatGPT. If it is empty, the authorization page accepts `API_TOKEN`.

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

There are three supported paths:

- Automatic installer from the Proxmox host, using a ready-to-run image.
- Docker Compose on an existing Linux machine or LXC.
- A local source build for development.

Full documentation lives in [docs/](docs/README.md):

- [Proxmox LXC install](docs/install-proxmox-lxc.md)
- [Docker install](docs/install-docker.md)
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
- [v0.7 validation](docs/v0.7-validation.md)
- [v0.8.1 validation](docs/v0.8.1-validation.md)
- [v0.9 validation](docs/v0.9-validation.md)
- [ChatGPT App](docs/chatgpt-app.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Roadmap](docs/roadmap.md)

## Automatic Proxmox Installer

The script [scripts/proxmox-create-lxc.sh](scripts/proxmox-create-lxc.sh) is designed to run as `root` on the Proxmox host. It creates the LXC, enables `nesting/keyctl`, installs Docker, downloads only the deployment files and starts the ready-to-run image. The LXC does not compile the application.

If you run it without variables, it asks for the configuration and uses defaults when you press Enter. When Proxmox can detect available options, the installer shows numbered choices for template storage, Debian template, root filesystem storage and network bridge. You can select a number, type a custom value or press Enter for the default.

The network defaults match your Roon VM network screenshot:

- Bridge: `vmbr30`
- VLAN Tag: `60`
- Proxmox firewall on net0: enabled
- IP: `dhcp`

Interactive one-liner:

```bash
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
```

Example with DHCP:

```bash
VMID=230 \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr30 \
VLAN_TAG=60 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
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
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=0.19.0')"
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

It performs:

- `git fetch`
- `git pull --ff-only`
- `docker compose pull`
- a data backup, graceful stop and `docker compose up -d --no-build`
- a health check and automatic rollback if the new image fails

You can also trigger the update from the Proxmox host:

```bash
pct exec 230 -- bash -lc 'bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"'
```

## Manual LXC Preparation

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

## Install The Project From A Ready Image

```bash
cd /opt
git clone https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git roon-ai-bridge
cd /opt/roon-ai-bridge
cp .env.example .env
docker compose pull
docker compose up -d --no-build
```

For a normal Linux server, a direct `docker run` option, channel selection and
source-build instructions, see [Docker install](docs/install-docker.md).

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

Privacy notice:

```bash
curl http://localhost:3000/privacy
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
  -d '{"query":"bad bunny monaco","title":"MONACO","image_key":"cover-123"}'

curl -X PATCH http://localhost:3000/playlists/bad-bunny-test \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad Bunny Test v0.10"}'

curl -X PUT http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"tracks":[{"query":"bad bunny dakiti"},{"query":"bad bunny monaco"}]}'

curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks/reorder \
  -H "Content-Type: application/json" \
  -d '{"track_ids":["<TRACK_ID_2>","<TRACK_ID_1>"]}'

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

Transfer the current queue and playback to another zone:

```bash
curl -X POST http://localhost:3000/roon/zones/transfer \
  -H "Content-Type: application/json" \
  -d '{"source_zone_id":"<SOURCE_ZONE_ID>","target_zone_id":"<TARGET_ZONE_ID>"}'
```

This calls Roon's native `transfer_zone` operation. It does not search for the
current track or rebuild the destination queue.

Group zones while preserving the primary zone queue:

```bash
curl -X POST http://localhost:3000/roon/zones/group \
  -H "Content-Type: application/json" \
  -d '{"primary_zone_id":"<PRIMARY_ZONE_ID>","additional_zone_ids":["<ZONE_ID_2>","<ZONE_ID_3>"]}'
```

Fully split a grouped zone:

```bash
curl -X POST http://localhost:3000/roon/zones/<GROUPED_ZONE_ID>/ungroup
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

## MCP Server And ChatGPT App

v0.6 added local MCP, v0.8 added remote MCP, v0.8.1 added OAuth and v0.9 adds typed media tools and structured UI results.

Build first:

```bash
npm run build
```

Run from `/opt/roon-ai-bridge`:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

The active MCP v2 facade exposes 36 canonical intent tools and six focused
model-visible read-only widget entry points. It replaces
the previous 89-tool catalog without legacy aliases. Named zones and outputs
are resolved inside each intent, and playback tools can search and act in one
MCP call when the match is unambiguous.

The catalog covers state, transport, volume, output power, playback options,
grouping, transfer, media search and deep details, play/enqueue/radio, queue,
virtual playlists, volume policies, zone presets and diagnostics.
See [MCP v2 Architecture](docs/mcp-v2-architecture.md) for the complete active
boundary and contract semantics.

Now-playing, adaptive media, playlist, playlist-library, queue and zone-panel
widgets are published under the cache-busted `ui://roon-ai-bridge/v19/`
namespace. They contain no controls, polling loops or widget-to-tool calls:
each renders the bounded result returned by one model-visible tool. ChatGPT connections are managed from the
portal under `Settings -> Connections`, together with OAuth
clients, approval PIN rotation and generic MCP client profiles.

Keep the stdio process local. The remote endpoint must stay behind HTTPS and authentication.

For requests such as "move what is playing in the office to the kitchen", an
MCP client calls `roon_transfer_playback` once with the two zone names. The
server resolves both names and explicitly avoids rebuilding the queue.

For grouping, call `roon_set_grouping` directly with a named primary zone and
named additional zones. A preliminary state-list call is unnecessary.

Remote MCP endpoint:

```text
https://roonia.ipchome.com/mcp
```

ChatGPT uses an OAuth access token. Administrative API calls may still use `API_TOKEN`:

```http
Authorization: Bearer <access_token-or-API_TOKEN>
```

See [ChatGPT App](docs/chatgpt-app.md) for setup notes.

## Prepared 501 Endpoints

These endpoints reserve the architecture and return `501 Not Implemented`:

- `GET /history`
- `GET /preferences`

Error format:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
      "message": "History is not implemented",
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
- v0.8: ChatGPT App remote MCP endpoint and minimal widget.
- v0.8.1: private ChatGPT App OAuth flow.
- v0.9: typed media tools, deterministic playback, structured widget results and OAuth hardening.
- v0.9.1: native playback transfer between Roon zones.
- v0.9.2: reliable widget hydration and verified playback control results.
- v0.10.0: SQLite virtual playlists, full playlist-management tools and normalized library item metadata with cover references.
- v0.11.0: complete administration portal and revocable role-based API keys.
- v0.12.0: native Roon settings, advanced SDK controls, artwork, presets, administrator accounts and safe updates.
- v0.13.0: zone presets and scheduled safe-volume limits.
- v0.14.0: advanced virtual playlists and candidate-based media matching.
- v0.15.0: reusable ChatGPT widget contracts.
- v0.16.0: operational diagnostics, audit logs and extension visibility.
- v0.17.0: MCP v2, focused widgets, portal redesign, connection management,
  persistent playlist identity and reliability improvements.
- v0.17.1: deterministic catalog navigation, strict track resolution, richer
  playlist UX and signed artwork for v17 widgets.
- v0.17.2: batched playlist creation, complete streaming catalog navigation,
  portal activity history, update-channel controls and embedded v18 artwork.
- v0.17.3: temporary working playlists, complete catalog-playlist reads,
  expanded v19 widgets and compact persistent player-zone controls.
- v0.18.0: typed application composition, one canonical MCP v2 implementation
  and focused portal, media, playlist and transport modules.

## Security

Do not publish port `3000` directly to the internet. If you expose the service through Nginx Proxy Manager, enable `ENABLE_AUTH=true`, set a long `API_TOKEN`, use HTTPS, and only expose the reverse-proxied domain.
