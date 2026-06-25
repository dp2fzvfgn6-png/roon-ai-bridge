# ChatGPT App

v0.8 prepares Roon AI Bridge as a ChatGPT app using the Apps SDK pattern: a remote MCP endpoint plus an optional widget resource.

## Public URLs

- MCP endpoint: `https://roonia.ipchome.com/mcp`
- Health check: `https://roonia.ipchome.com/health`
- Privacy notice: `https://roonia.ipchome.com/privacy`

`/health` and `/privacy` are public. `/mcp` requires:

```text
Authorization: Bearer <API_TOKEN>
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

Recommended connector URL:

```text
https://roonia.ipchome.com/mcp
```

Authentication:

```text
Bearer token
API_TOKEN from /opt/roon-ai-bridge/.env
```

If the setup asks for a privacy URL:

```text
https://roonia.ipchome.com/privacy
```

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
- Keep the token private.
- For volume, queue and playback changes, the app should confirm the zone when the target is ambiguous.
- v0.8 uses a shared API token. OAuth and per-user authorization are left for a later phase.
