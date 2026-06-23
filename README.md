# Roon AI Bridge

Extensión local para Roon con API HTTP en Node.js. La v0.1 está limitada a validar que un LXC separado, en la misma VLAN/subred que Roon Core, puede registrar y autorizar una extensión, listar zonas, leer now playing, controlar reproducción y cambiar volumen cuando Roon lo permite.

No expone nada a internet. No implementa autenticación, MCP, OpenAI, ChatGPT, Cloudflare, TIDAL directo, playlists ni búsqueda avanzada.

## Arquitectura

El proyecto está preparado como base modular para crecer sin convertir la v0.1 en un script monolítico.

```text
src/
  index.ts
  config/          variables de entorno y configuración
  roon/            conexión, tipos y servicios Roon
  api/             servidor Express y rutas HTTP
  services/        servicios de aplicación futuros
  db/              adaptador futuro de persistencia
  mcp/             documentación y stubs futuros MCP
  security/        notas de seguridad futuras
  utils/           logger, errores y validación
db/
  schema.sql       esquema SQLite previsto
data/
  roonstate.json   autorización de Roon en runtime
```

La v0.1 usa `node-roon-api` y `node-roon-api-transport`. `node-roon-api-browse` queda reservado para v0.2.

## Qué implementa v0.1

- Registro de extensión en Roon.
- Autorización desde `Settings > Setup > Extensions`.
- Conexión y reconexión con Roon Core en LAN.
- Listado de zonas.
- Now playing básico.
- Control `play`, `pause`, `playpause`, `stop`, `next`, `previous`.
- Control de volumen relativo o absoluto si el output lo soporta.
- API HTTP local en puerto configurable.
- Errores homogéneos.
- Logs centralizados.

## Variables de entorno

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Valores principales:

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

## Despliegue en LXC Proxmox

Hay dos caminos:

- Instalador automático desde el host Proxmox.
- Instalación manual dentro de un LXC creado previamente.

## Instalador automático Proxmox

El script [scripts/proxmox-create-lxc.sh](scripts/proxmox-create-lxc.sh) está pensado para ejecutarse en la consola del host Proxmox como `root`. Crea el LXC, activa `nesting/keyctl`, instala Docker dentro del contenedor y, si le pasas `REPO_URL`, clona y arranca la app.

Ejemplo con DHCP:

```bash
VMID=230 \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr0 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash scripts/proxmox-create-lxc.sh
```

Ejemplo con IP fija y VLAN:

```bash
VMID=230 \
HOSTNAME=roon-ai-bridge \
ROOTFS_STORAGE=local-lvm \
BRIDGE=vmbr0 \
VLAN_TAG=20 \
IP_CIDR=192.168.20.50/24 \
GATEWAY=192.168.20.1 \
REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git \
bash scripts/proxmox-create-lxc.sh
```

Cuando el repo esté publicado, también puedes usarlo en formato “pegar un comando”, parecido a PVE helper scripts:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh)"
```

Con variables:

```bash
VMID=230 BRIDGE=vmbr0 VLAN_TAG=20 IP_CIDR=192.168.20.50/24 GATEWAY=192.168.20.1 REPO_URL=https://github.com/dp2fzvfgn6-png/roon-ai-bridge.git bash -c "$(curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/proxmox-create-lxc.sh)"
```

Variables útiles:

- `VMID`: ID del LXC. Si no se define, el script intenta usar el siguiente libre.
- `HOSTNAME`: por defecto `roon-ai-bridge`.
- `TEMPLATE_STORAGE`: por defecto `local`.
- `TEMPLATE`: por defecto Debian 12.
- `ROOTFS_STORAGE`: por defecto `local-lvm`.
- `ROOTFS_SIZE`: por defecto `8G`.
- `MEMORY`: por defecto `1024`.
- `SWAP`: por defecto `512`.
- `CORES`: por defecto `1`.
- `BRIDGE`: por defecto `vmbr0`.
- `VLAN_TAG`: opcional.
- `IP_CIDR`: por defecto `dhcp`.
- `GATEWAY`: requerido si usas IP fija.
- `REPO_URL`: URL Git del proyecto. Si no se define, solo crea el LXC con Docker.
- `GIT_REF`: rama/tag, por defecto `main`.
- `PORT`: por defecto `3000`.
- `PRIVILEGED`: por defecto `1`, recomendado para simplificar Docker dentro de LXC.

Después del instalador, autoriza la extensión en Roon:

```text
Settings > Setup > Extensions > Roon AI Bridge
```

## Instalación manual

1. Crea un LXC Debian/Ubuntu dedicado llamado `roon-ai-bridge`.
2. Ponlo en la misma bridge/VLAN que el Roon Core.
3. Comprueba que el LXC tiene IP de la misma subred.
4. Verifica conectividad:

```bash
ping <IP_DEL_ROON_CORE>
```

## Instalar Docker y Docker Compose

Debian:

```bash
apt update
apt install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Si el LXC usa Ubuntu, cambia la URL a `https://download.docker.com/linux/ubuntu`.

## Instalar el proyecto

```bash
cd /opt
git clone <URL_DE_ESTE_REPO> roon-ai-bridge
cd /opt/roon-ai-bridge
cp .env.example .env
docker compose up -d --build
```

Ver logs:

```bash
docker compose logs -f
```

Docker Compose usa:

- `network_mode: host`
- `restart: unless-stopped`
- `env_file: .env`
- `./data:/app/data`

## Autorizar en Roon

Abre Roon:

```text
Settings > Setup > Extensions > Roon AI Bridge
```

Pulsa `Enable`. La autorización queda persistida en `./data/roonstate.json`.

## Endpoints funcionales

Health:

```bash
curl http://localhost:3000/health
```

Estado:

```bash
curl http://localhost:3000/roon/status
```

Capacidades:

```bash
curl http://localhost:3000/roon/capabilities
```

Zonas:

```bash
curl http://localhost:3000/roon/zones
```

Control:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/control \
  -H "Content-Type: application/json" \
  -d '{"command":"playpause"}'
```

Volumen relativo:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"relative","value":1}'
```

Volumen absoluto:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"absolute","value":35}'
```

## Endpoints preparados con 501

Estos endpoints existen para fijar la arquitectura, pero devuelven `501 Not Implemented` en v0.1:

- `GET /roon/library`
- `GET /roon/search?q=...`
- `POST /roon/play`
- `GET /roon/queue/:zone_id`
- `POST /roon/queue/:zone_id`
- `GET /playlists`
- `POST /playlists`
- `POST /playlists/:playlist_id/play`
- `GET /history`
- `GET /preferences`

Formato de error:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Search is not implemented in v0.1",
    "details": {}
  }
}
```

## Códigos de error previstos

- `ROON_NOT_CONNECTED`
- `ROON_NOT_AUTHORIZED`
- `TRANSPORT_NOT_READY`
- `ZONE_NOT_FOUND`
- `OUTPUT_NOT_FOUND`
- `UNSUPPORTED_COMMAND`
- `VOLUME_NOT_SUPPORTED`
- `INVALID_VOLUME_MODE`
- `INVALID_VOLUME_VALUE`
- `NOT_IMPLEMENTED`
- `INTERNAL_ERROR`

## Troubleshooting en LXC separado

Si Roon no muestra la extensión:

- Confirma que el LXC está en la misma VLAN/subred que Roon Core.
- Usa `network_mode: host`; el descubrimiento de Roon depende de la red local.
- Revisa firewalls del LXC, Proxmox y la VM/LXC de Roon Core.
- Comprueba que no estás usando Docker bridge para este servicio.
- Revisa logs con `docker compose logs -f`.
- Borra `./data/roonstate.json` solo si quieres forzar una nueva autorización.

Si `/roon/status` dice `transport_ready: false`, la extensión puede estar pendiente de autorización o Roon todavía no ha expuesto el servicio de transporte.

## Roadmap

- v0.1: control básico.
- v0.2: browse/library.
- v0.3: search/play by query.
- v0.4: queue management.
- v0.5: virtual playlists.
- v0.6: MCP server.
- v0.7: auth + Cloudflare Tunnel.
- v0.8: ChatGPT App / integración final.

## Seguridad

Esta fase es solo LAN. No publiques el puerto `3000` a internet y no lo pongas detrás de túneles, proxies públicos ni reglas NAT. La autenticación queda planificada para una fase posterior.
