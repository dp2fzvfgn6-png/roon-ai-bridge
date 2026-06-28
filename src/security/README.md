# Security Notes

v0.8.1 supports optional API-token authentication and OAuth access tokens for the remote MCP endpoint.

For LAN-only use, authentication can stay disabled. Before exposing the service through Nginx Proxy Manager or any public reverse proxy, set:

```env
ENABLE_AUTH=true
API_TOKEN=<long random token>
```

`/health`, `/privacy`, `/.well-known/*` and `/oauth/*` remain public. Roon, playlist, history, preferences and MCP endpoints require a valid Bearer token:

```http
Authorization: Bearer <API_TOKEN>
```

ChatGPT obtains its Bearer token through the OAuth authorization-code flow with PKCE. The private approval page requires `OAUTH_APPROVAL_PIN`, falling back to `API_TOKEN` when no separate PIN is configured.

Do not expose port `3000` directly. Publish only the HTTPS reverse-proxied domain and keep `ENABLE_AUTH=true`.

Future phases should define:

- resource-bound tokens and enforced scopes
- refresh/revocation support
- per-user identities
- Cloudflare Tunnel policy
- allowed commands and zones
- audit logging
- remote MCP tool safety boundaries
