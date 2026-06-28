# Roon AI Bridge Documentation

This documentation covers the current v0.8.1 repository:

- [Overview](overview.md)
- [Proxmox LXC Install](install-proxmox-lxc.md)
- [Update Existing LXC](update-lxc.md)
- [Configuration](configuration.md)
- [HTTP API](api.md)
- [Architecture](architecture.md)
- [v0.1 Validation](v0.1-validation.md)
- [v0.2 Validation](v0.2-validation.md)
- [v0.3 Validation](v0.3-validation.md)
- [v0.4 Validation](v0.4-validation.md)
- [v0.5 Validation](v0.5-validation.md)
- [v0.6 Validation](v0.6-validation.md)
- [v0.7 Validation](v0.7-validation.md)
- [v0.8.1 Validation](v0.8.1-validation.md)
- [ChatGPT App](chatgpt-app.md)
- [Troubleshooting](troubleshooting.md)
- [Roadmap](roadmap.md)

Quick install from the Proxmox host:

```bash
bash -c "$(curl -fsSL 'https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh?v=rootfs-fix')"
```

Quick update from inside the LXC:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh)"
```
