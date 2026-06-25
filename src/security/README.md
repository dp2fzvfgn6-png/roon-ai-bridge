# Security Notes

v0.7 supports optional Bearer-token authentication for the HTTP API.

For LAN-only use, authentication can stay disabled. Before exposing the service through Nginx Proxy Manager or any public reverse proxy, set:

```env
ENABLE_AUTH=true
API_TOKEN=<long random token>
```

`/health` remains public. All other HTTP endpoints require:

```http
Authorization: Bearer <API_TOKEN>
```

Do not expose the MCP stdio process remotely. v0.7 only protects the HTTP API.

Future phases should define:

- scoped tokens
- Cloudflare Tunnel policy
- allowed commands and zones
- audit logging
- remote MCP tool safety boundaries
