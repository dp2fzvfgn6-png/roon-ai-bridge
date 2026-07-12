# Update Existing LXC

The Proxmox installer is only for the Proxmox host. It uses host commands such as:

- `pct`
- `pveam`
- `pvesh`

Do not use the installer inside the LXC.

## Update From Inside The LXC

Run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"
```

The updater:

- Enters `/opt/roon-ai-bridge`.
- Fetches latest GitHub changes.
- Runs `git pull --ff-only`.
- Publishes download, build, restart and verification stages for the portal.
- Rebuilds and restarts the app with Docker Compose, embedding the Git commit
  as the visible build identifier.
- Verifies that the updated container is running before reporting success.

The systemd watcher installs the versioned `scripts/lxc-apply-update.sh` file
directly. It does not generate shell source or require Node.js on the LXC host.
Every accepted request ends by writing either `completed` or `failed` to
`data/update-status.json`, so the portal cannot remain indefinitely in a
preparation state after an updater error.

Equivalent manual commands:

```bash
cd /opt/roon-ai-bridge
git fetch origin main
git checkout main
git pull --ff-only origin main
docker compose up -d --build
```

## Update From The Proxmox Host

Replace `230` with the LXC VMID:

```bash
pct exec 230 -- bash -lc 'bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"'
```

## Logs After Update

Inside the LXC:

```bash
cd /opt/roon-ai-bridge
docker compose logs -f
```

From the Proxmox host:

```bash
pct exec 230 -- bash -lc "cd /opt/roon-ai-bridge && docker compose logs -f"
```
