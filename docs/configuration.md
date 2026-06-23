# Configuration

Runtime configuration lives in `.env`.

Default `.env.example`:

```env
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
ROON_EXTENSION_NAME=Roon AI Bridge
ROON_EXTENSION_ID=com.linestudio.roon-ai-bridge
DATA_DIR=/app/data
ENABLE_BROWSE=false
ENABLE_MCP=false
ENABLE_AUTH=false
```

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
