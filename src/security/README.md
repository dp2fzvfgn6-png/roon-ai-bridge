# Security Notes

v0.3 is LAN-only and intentionally has no authentication.

Do not expose port 3000 to the internet. Do not publish this service through NAT, a public reverse proxy, a tunnel or Cloudflare until authentication and an authorization model exist.

Future phases should define:

- local authentication
- token storage
- Cloudflare Tunnel policy
- allowed commands and zones
- audit logging
- MCP tool safety boundaries
