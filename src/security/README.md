# Security Notes

v0.8 supports optional Bearer-token authentication for the HTTP API and remote MCP endpoint.

For LAN-only use, authentication can stay disabled. Before exposing the service through Nginx Proxy Manager or any public reverse proxy, set:

```env
ENABLE_AUTH=true
API_TOKEN=<long random token>
```

`/health` and `/privacy` remain public. Roon, playlist, history, preferences and MCP endpoints require:

```http
Authorization: Bearer <API_TOKEN>
```

Do not expose port `3000` directly. Publish only the HTTPS reverse-proxied domain and keep `ENABLE_AUTH=true`.

Future phases should define:

- scoped tokens
- Cloudflare Tunnel policy
- allowed commands and zones
- audit logging
- remote MCP tool safety boundaries
