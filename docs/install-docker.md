# Docker Install

This option works on an existing Debian or Ubuntu server, virtual machine or
LXC. The machine must be on the same local network as Roon Core because Roon
discovery uses the host network.

## Docker Compose (Recommended)

Install Docker Engine and the Compose plugin, then:

```bash
sudo mkdir -p /opt/roon-ai-bridge
sudo chown "$USER":"$USER" /opt/roon-ai-bridge
cd /opt/roon-ai-bridge
curl -fsSLO https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/docker-compose.yml
curl -fsSLo .env https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/.env.example
mkdir -p data
docker compose pull
docker compose up -d --no-build
```

This installs the `stable` image. To use beta, add these lines to `.env` before
pulling:

```dotenv
ROONIA_IMAGE_TAG=beta
INSTALLED_CHANNEL=beta
```

Then authorize RoonIA from `Settings > Setup > Extensions` in Roon.

## Direct Docker Run

If Compose is not desired:

```bash
mkdir -p "$PWD/data"
docker run -d \
  --name roon-ai-bridge \
  --network host \
  --restart unless-stopped \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  ghcr.io/dp2fzvfgn6-png/roon-ai-bridge:stable
```

With this direct form, updates are manual: pull the new image, stop and remove
the old container gracefully, then repeat the command. Back up `data/` first.

## Build From Source (Development)

Developers can still clone the repository and build locally:

```bash
git clone https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git
cd roon-ai-bridge
cp .env.example .env
docker compose build
docker compose up -d
```

Normal users do not need Node.js, pnpm or a local compilation. GitHub Actions
creates the published amd64 and arm64 images after the automated tests pass.

## Check The Installation

```bash
curl http://localhost:3000/health
docker logs roon-ai-bridge
```

The GHCR package must be public for anonymous downloads. The repository owner
must set that visibility once after the package is first published.
