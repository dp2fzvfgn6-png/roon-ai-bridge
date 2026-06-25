# ChatGPT App

v0.8.1 prepares Roon AI Bridge as a ChatGPT app using the Apps SDK pattern: a remote MCP endpoint, OAuth, and an optional widget resource.

## Public URLs

- MCP endpoint: `https://roonia.ipchome.com/mcp`
- Health check: `https://roonia.ipchome.com/health`
- Privacy notice: `https://roonia.ipchome.com/privacy`

`/health`, `/privacy`, `/.well-known/*` and `/oauth/*` are public. `/mcp` requires an OAuth access token or the admin API token:

```text
Authorization: Bearer <access_token>
```

## Architecture

The app path is:

```text
ChatGPT App -> HTTPS MCP endpoint -> Roon AI Bridge -> Roon Core
```

The MCP server exposes tools for:

- Roon status.
- Zone listing.
- Playback control.
- Volume control.
- Search and play by query.
- Queue snapshots and queue mutations.
- Local virtual playlists.

The server also registers a minimal Apps SDK widget resource:

```text
ui://roon-ai-bridge/control-v1.html
```

## ChatGPT Developer Setup

Use the Apps SDK / MCP app flow, not Custom GPT Actions.

Application fields:

```text
Name: RoonIA
Description: Control privado de Roon desde ChatGPT: zonas, reproducción, volumen, búsqueda, cola y playlists virtuales.
Connection: URL del servidor
Server URL: https://roonia.ipchome.com/mcp
Authentication: OAuth
```

OAuth should be auto-detected from:

```text
https://roonia.ipchome.com/.well-known/oauth-protected-resource
https://roonia.ipchome.com/.well-known/oauth-authorization-server
```

Dynamic client registration endpoint:

```text
https://roonia.ipchome.com/oauth/register
```

Authorization endpoint:

```text
https://roonia.ipchome.com/oauth/authorize
```

Token endpoint:

```text
https://roonia.ipchome.com/oauth/token
```

If ChatGPT asks for scopes, use:

```text
roon:control
```

If the setup asks for a privacy URL:

```text
https://roonia.ipchome.com/privacy
```

During authorization, RoonIA asks for an approval PIN. The PIN is:

- `OAUTH_APPROVAL_PIN` if configured in `/opt/roon-ai-bridge/.env`.
- Otherwise the existing `API_TOKEN`.

## First Prompts

```text
Comprueba el estado de Roon.
```

Expected tool: `roon_status`.

```text
Lista las zonas de Roon.
```

Expected tool: `roon_list_zones`.

```text
Pausa la zona Despacho.
```

Expected tool: `roon_control_playback`.

```text
Busca Bad Bunny en Roon.
```

Expected tool: `roon_search`.

```text
Reproduce Bad Bunny en Despacho.
```

Expected tool: `roon_play_by_query`.

## Safety Notes

- Keep `ENABLE_AUTH=true` before exposing `/mcp`.
- Use HTTPS through Nginx Proxy Manager.
- Keep the API token and OAuth approval PIN private.
- For volume, queue and playback changes, the app should confirm the zone when the target is ambiguous.
- v0.8.1 uses a private OAuth flow with one local approval PIN. Per-user authorization and refresh tokens are left for a later phase.
