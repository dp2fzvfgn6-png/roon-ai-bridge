# Connections and OAuth

The administration portal owns external AI connections under
`Settings -> Connections`. Operators should not need to edit `oauth-store.json`
or create credentials from a shell.

## ChatGPT

The portal shows the MCP URL, OAuth endpoints, scope, route and public-DNS
readiness checks. ChatGPT still requires the user to confirm the connection in
its own account; no public API allows RoonIA to create it automatically.

There are two supported connection routes:

- **Public URL:** the MCP hostname must resolve in public DNS and the endpoint
  must be reachable from OpenAI over HTTPS. The portal then links to the
  ChatGPT plugin page and the normal OAuth/DCR flow applies.
- **Secure MCP Tunnel:** use this for a private or on-premises bridge. The
  OpenAI tunnel client runs inside the private network and makes an outbound
  connection; RoonIA does not need a public DNS record or inbound exposure.
  The portal links to the organization tunnel settings and uses
  `http://127.0.0.1:3000/mcp` as the private MCP target.

If the configured hostname only exists in local DNS, direct URL setup fails in
ChatGPT with a gateway/OAuth discovery error even when all OAuth metadata works
inside the LAN. The portal reports this separately and recommends the tunnel.
Changing the public bridge URL under `Settings -> System` also updates the
effective OAuth issuer after restart, taking precedence over a legacy
`OAUTH_ISSUER` value in the environment.
Creating the tunnel still requires an OpenAI Platform organization, a tunnel
ID and its short-lived runtime API key; those secrets are not stored by RoonIA.

For a publicly reachable URL, the preferred flow is OAuth dynamic client
registration (DCR):

1. Copy the MCP URL from the portal.
2. Create a developer-mode plugin in ChatGPT.
3. ChatGPT reads protected-resource and authorization-server metadata.
4. ChatGPT registers a public client and starts authorization-code + PKCE S256.
5. RoonIA asks for the approval PIN and issues a resource-bound token.

If a host does not call DCR, create a client from the portal using the exact
redirect URL shown by that host. The generated client ID is public and can be
copied from the client list; there is no client secret.

The portal can also:

- list registered clients without exposing access tokens;
- show active-token count and last use;
- revoke every code/token for one client;
- permanently delete a client;
- rotate the approval PIN.

The portal-managed PIN is derived with scrypt in `oauth-settings.json`. Its
plain value is never stored or returned. Until it is rotated in the portal,
`OAUTH_APPROVAL_PIN` (or the API token fallback) remains compatible.

## LM Studio, Ollama hosts and generic MCP clients

Clients without the RoonIA OAuth flow can use an isolated managed API key. The
portal creates a read-only or control credential and produces a Streamable HTTP
configuration containing the public `/mcp` URL and Bearer header. The secret is
shown once.

LM Studio can consume the generated MCP server block when its installed
version supports remote MCP. Ollama itself supplies a model rather than an MCP
client; use the Ollama profile in an MCP-capable host that runs an Ollama model.
The generic profile is suitable for other hosts after adapting any
client-specific key names.

Every generated credential appears in Connections and the general API-key
administration page, where it can be revoked, reactivated or deleted.

## Portal API

- `GET /api/admin/connections`
- `POST /api/admin/connections/oauth/clients`
- `POST /api/admin/connections/oauth/clients/:client_id/revoke`
- `DELETE /api/admin/connections/oauth/clients/:client_id`
- `PATCH /api/admin/connections/oauth/pin`
- `POST /api/admin/connections/mcp-credentials`

All routes require portal administrator authentication and are included in the
portal action audit.
