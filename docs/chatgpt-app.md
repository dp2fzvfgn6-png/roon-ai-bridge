# ChatGPT App

> Current status: ChatGPT is intentionally disconnected while the new MCP v2
> facade and later widget redesign are developed. The setup and legacy tool
> examples below are historical and must not be used to validate MCP v2.

v0.12.4 exposes Roon AI Bridge as a private ChatGPT app with typed media tools, OAuth, verified playback results and an interactive widget resource.

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
ui://roon-ai-bridge/control-v6/default.html
```

When tool schemas, descriptions or widget behavior change, refresh the ChatGPT
app configuration and start a new conversation. ChatGPT can keep older tool
metadata cached even after the backend deploy succeeds; the versioned
`ui://roon-ai-bridge/control-v6/default.html` resource URI invalidates the widget cache.

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

For `play`, `pause`, `playpause` and `stop`, the tool returns the final zone
state and `state_verified: true`. ChatGPT must not claim success otherwise.

```text
Traslada lo que esta sonando en el Despacho a la Cocina.
```

Expected flow: `roon_list_zones` if IDs are not already known, followed by one
`roon_transfer_playback` call. The app must not search for the current music or
rebuild the destination queue.

```text
Busca Bad Bunny en Roon.
```

Expected tool: `roon_search_media`.

```text
Reproduce Bad Bunny en Despacho.
```

Expected flow: `roon_search_media` followed by `roon_play_media`.

For artist requests:

- `roon_play_media` plays only the selected artist catalog using Roon Shuffle.
- `roon_start_radio` starts Roon Radio and intentionally includes similar artists.

## Safety Notes

- Keep `ENABLE_AUTH=true` before exposing `/mcp`.
- Use HTTPS through Nginx Proxy Manager.
- Keep the API token and OAuth approval PIN private.
- For volume, queue and playback changes, the app should confirm the zone when the target is ambiguous.
- v0.8.1 uses a private OAuth flow with one local approval PIN. Per-user authorization and refresh tokens are left for a later phase.
