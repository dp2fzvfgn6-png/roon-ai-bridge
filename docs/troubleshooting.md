# Troubleshooting

## Extension Does Not Appear In Roon

Check:

- LXC is on the same VLAN/subnet as Roon Core.
- Bridge is correct, for example `vmbr30`.
- VLAN tag is correct, for example `60`.
- Docker Compose uses `network_mode: host`.
- Proxmox firewall, LXC firewall and Roon Core firewall are not blocking discovery.
- The app container is running.

Commands:

```bash
docker compose ps
docker compose logs -f
curl http://localhost:3000/health
curl http://localhost:3000/roon/status
```

## Roon Status Shows `transport_ready: false`

Possible causes:

- Extension has not been enabled in Roon.
- Roon Core was discovered but transport service is not ready yet.
- Roon Core and the LXC are not actually on the same layer-2 network.

Authorize in Roon:

```text
Settings > Setup > Extensions > Roon AI Bridge
```

## Force New Roon Authorization

Inside `/opt/roon-ai-bridge`:

```bash
docker compose down
rm -f data/roonstate.json
docker compose up -d --no-build
docker compose logs -f
```

Then authorize again in Roon.

## Docker Fails Inside LXC

Check Proxmox LXC features:

```text
nesting=1
keyctl=1
```

The installer creates a privileged LXC by default. That is intentional for simpler Docker-in-LXC behavior.

## Update Fails

Inside the LXC:

```bash
cd /opt/roon-ai-bridge
git status
git remote -v
docker compose logs --tail=100
cat data/update-status.json
cat data/installed-release.json
```

The updater normally keeps the previous version running after an error and
reports the reason in `update-status.json`. If repository deployment files were
edited inside the LXC, `git pull --ff-only` may refuse to update; preserve or
revert those edits before retrying. Do not delete `data/backups/` until the
installation has been checked.
