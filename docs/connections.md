# Connections and OAuth

The administration portal owns external AI connections under
`Settings -> Connections`. Operators should not need to edit `oauth-store.json`
or create credentials from a shell.

## ChatGPT

The portal shows the MCP URL, OAuth endpoints, scope, local readiness checks
and a shortcut to the ChatGPT plugin page. ChatGPT still requires the user to
confirm plugin creation on `chatgpt.com`; no public API allows RoonIA to create
the plugin in another account.

The preferred flow is OAuth dynamic client registration (DCR):

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
