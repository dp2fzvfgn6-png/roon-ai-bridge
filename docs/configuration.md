# Configuration

Runtime configuration lives in `.env`.

Default `.env.example`:

```env
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=Roon AI Bridge
ROON_EXTENSION_ID=com.local.roon-ai-bridge
DATA_DIR=/app/data
ENABLE_BROWSE=true
ENABLE_MCP=false
ENABLE_AUTH=false
API_TOKEN=
```

## HTTP API Authentication

Authentication is disabled by default for LAN-only use:

```env
ENABLE_AUTH=false
```

Before exposing the API through Nginx Proxy Manager or any reverse proxy, enable it and set a long random token:

```bash
openssl rand -hex 32
```

Then put the generated value in `.env`:

```env
ENABLE_AUTH=true
API_TOKEN=<PASTE_GENERATED_TOKEN_HERE>
```

When auth is enabled, `/health` remains public. All other HTTP endpoints require:

```http
Authorization: Bearer <API_TOKEN>
```

The app refuses to start if `ENABLE_AUTH=true` and `API_TOKEN` is empty.

## Docker Compose

The service uses:

```yaml
network_mode: host
restart: unless-stopped
env_file:
  - .env
volumes:
  - ./data:/app/data
```

`network_mode: host` is important for Roon discovery on the LAN.

## Persistence

Runtime data is mounted into:

```text
./data:/app/data
```

Roon authorization state is stored at runtime in:

```text
./data/roonstate.json
```

Do not delete this file unless you want to force Roon authorization again.
