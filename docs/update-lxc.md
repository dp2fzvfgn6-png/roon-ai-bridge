# Update Existing LXC

The normal update remains the button in the administration portal. A push to
`main` or `beta` first passes the tests in GitHub Actions. GitHub then builds the
Docker image. Only after that image exists does RoonIA offer it as an update.
Nothing needs to be compiled on the user's computer or inside the LXC.

## What The Portal Update Does

1. Downloads the ready-to-run `stable` or `beta` image from GHCR.
2. Stops the current container gracefully.
3. Creates a dated backup under `data/backups/`.
4. Starts the downloaded image without building source code.
5. Waits until Docker reports the application as healthy.
6. Keeps the five newest pre-update backups.

If the new container does not start or become healthy, the updater restores the
previous image, `.env` file and data backup before reporting the failure.

## First Update From An Older Installation

The first update after upgrading from the old source-building system should be
started normally from the portal. That bridge update refreshes the host scripts
and then installs the published image. Later updates use only the image flow.

It is also possible to refresh the updater manually from inside the LXC:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/main/scripts/lxc-update-app.sh)"
```

For a beta installation, use:

```bash
GIT_REF=beta bash -c "$(curl -fsSL https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/beta/scripts/lxc-update-app.sh)"
```

The Proxmox creation script must only be run on the Proxmox host. It uses host
commands such as `pct`, `pveam` and `pvesh`.

## Update From The Proxmox Host

Replace `230` with the LXC VMID:

```bash
pct exec 230 -- bash -lc 'bash -c "$(curl -fsSL https://raw.githubusercontent.com/LINEdev-ipc/roon-ai-bridge/main/scripts/lxc-update-app.sh)"'
```

## Manual Image Commands

These commands skip the backup and rollback orchestration, so the portal or
versioned updater is preferred:

```bash
cd /opt/roon-ai-bridge
docker compose pull
docker compose up -d --no-build
```

## Logs And Installed Release

```bash
cd /opt/roon-ai-bridge
docker compose logs -f
cat data/installed-release.json
```

`installed-release.json` contains the installed version, Git revision, channel,
image ID and registry digest. It contains no credentials.

## One-Time GHCR Setting

The package `ghcr.io/linedev-ipc/roon-ai-bridge` must be public so normal
installations can download it without a GitHub token. After the first workflow
publication, open the package settings on GitHub and change its visibility to
public. This is a one-time repository-owner action.
