# Nexterm

A web-based remote access client supporting SSH, SFTP, RDP, VNC, Telnet, and FTP. Self-hosted, lightweight, and deployable on any Linux or macOS system.

## Features

- **Multi-protocol** -- SSH, SFTP, RDP, VNC, Telnet, FTP in one interface
- **Web-based terminal** -- Full xterm.js terminal with GPU-accelerated rendering, search, and clipboard support
- **SFTP file browser** -- Browse, upload, download, and edit remote files
- **Saved sessions** -- Organize connections in folders with encrypted credential storage
- **Multi-user** -- User registration and API key authentication
- **AI assistant** -- Optional OpenAI / Anthropic / Ollama integration for command generation, error diagnosis, command explanation, and log analysis
- **Server tools** -- Docker, firewall, service, process, and package management panels
- **System metrics** -- Real-time CPU, memory, disk, and network monitoring via WebSocket
- **Themes** -- Multiple terminal color schemes
- **HTTPS by default** -- Auto-generated self-signed certificates
- **Remote desktop** -- RDP and VNC via Apache Guacamole (guacd) with canvas rendering, mouse, and keyboard input
- **Lightweight** -- SQLite database, no external services required (guacd optional for RDP/VNC)

## RDP & VNC Support

RDP and VNC connections are handled via [Apache Guacamole](https://guacamole.apache.org/) (`guacd`). This is an optional external dependency -- SSH, Telnet, FTP, and SFTP work without it.

### Enabling guacd

**Docker (recommended):**

```bash
docker run -d --name guacd --restart unless-stopped -p 4822:4822 guacamole/guacd
```

Or use the Docker Compose `rdp` profile:

```bash
docker compose --profile rdp up -d
```

**Config (`config.yaml`):**

```yaml
guacd:
  enabled: true
  host: "localhost"   # or "guacd" if using Docker networking
  port: 4822
```

Or via environment variables:

```bash
NEXTERM_GUACD_ENABLED=true NEXTERM_GUACD_HOST=localhost ./venv/bin/python run.py
```

When guacd is disabled, opening an RDP or VNC tab will show a message prompting you to enable it. All other protocols remain fully functional.

### How it works

1. The browser opens a WebSocket to `/ws/guacamole`
2. The backend authenticates via JWT and resolves connection parameters (host, credentials, resolution)
3. The backend connects to guacd over TCP and performs the Guacamole protocol handshake
4. A bidirectional relay starts -- the backend transparently proxies Guacamole instructions between the browser and guacd
5. The frontend uses `guacamole-common-js` (`Guacamole.Client`, `Guacamole.Display`, `Guacamole.Mouse`, `Guacamole.Keyboard`) to render the remote desktop in a `<canvas>` element

## Quick Start

### Option 1: One-Command Install (Linux / macOS)

```bash
git clone https://github.com/tifuck/nexterm.git
cd nexterm
bash install.sh
```

The installer will:
1. Check prerequisites (Python 3.10+, Node.js 18+)
2. Prompt for app name and server port
3. Set up a Python virtual environment and install dependencies
4. Build the React frontend
5. Generate a self-signed SSL certificate
6. Initialize the database
7. Optionally install a systemd service

Once complete, start the server:

```bash
./venv/bin/python run.py
```

Then open `https://localhost:8443` in your browser.

### Option 2: Docker

```bash
git clone https://github.com/tifuck/nexterm.git
cd nexterm
docker compose up -d
```

To customize the port:

```bash
NEXTERM_PORT=9000 docker compose up -d
```

To include RDP support (starts guacd):

```bash
docker compose --profile rdp up -d
```

### Option 3: Windows (WSL)

Nexterm requires a Unix environment. On Windows, use WSL2:

1. Install WSL2: `wsl --install` (from PowerShell as Administrator)
2. Open your WSL terminal (Ubuntu)
3. Follow the Linux install instructions above

## Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| Python | 3.10+ | With `pip` and `venv` modules |
| Node.js | 18+ | With `npm` |
| Docker | (optional) | For Docker deployment or RDP/VNC support (guacd) |

On Debian/Ubuntu:
```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv nodejs npm
```

On Fedora/RHEL:
```bash
sudo dnf install python3 python3-pip nodejs npm
```

On macOS:
```bash
brew install python3 node
```

## Updating

### Bare-metal

```bash
bash update.sh
```

This pulls the latest code, updates dependencies, rebuilds the frontend, updates the database schema, and restarts the systemd service if it's running.

### Docker

```bash
docker compose down
git pull
docker compose up -d --build
```

## Uninstalling

```bash
bash uninstall.sh
```

This will:
1. Stop and remove the systemd service
2. Remove the guacd Docker container (if present)
3. Optionally remove application data (database, certs, config)
4. Optionally remove build artifacts (venv, node_modules)
5. Optionally remove the entire installation directory

## Configuration

Configuration is managed via `config.yaml` (auto-generated from `config.example.yaml` on first run).

### Environment Variable Overrides

Every setting can be overridden with a `NEXTERM_` prefixed environment variable. This is particularly useful for Docker deployments:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXTERM_APP_NAME` | `TERMINAL` | Application display name |
| `NEXTERM_HOST` | `0.0.0.0` | Bind address |
| `NEXTERM_PORT` | `8443` | Server port |
| `NEXTERM_SECRET_KEY` | (auto-generated) | JWT signing key |
| `NEXTERM_DEBUG` | `false` | Enable debug mode |
| `NEXTERM_REGISTRATION_ENABLED` | `true` | Allow user self-registration |
| `NEXTERM_HTTPS_ENABLED` | `true` | Enable HTTPS |
| `NEXTERM_GUACD_ENABLED` | `false` | Enable RDP/VNC support via guacd |
| `NEXTERM_GUACD_HOST` | `localhost` | guacd hostname |
| `NEXTERM_GUACD_PORT` | `4822` | guacd port |

See `config.example.yaml` for the full list of configuration options.

## Development

### Backend

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8443
```

### Frontend

```bash
cd frontend
npm run dev    # Dev server on http://localhost:3000 (proxies to backend)
```

### Architecture

```
                    ┌─────────────────────────┐
                    │       Browser (SPA)      │
                    │  React + xterm.js + WS   │
                    │  guacamole-common-js      │
                    └──────────┬──────────────┘
                               │ HTTPS / WSS
                    ┌──────────▼──────────────┐
                    │    FastAPI (uvicorn)     │
                    │   REST API + WebSocket   │
                    │   Static file serving    │
                    └──┬───────────────────┬──┘
                       │ Unix socket IPC   │ TCP :4822
            ┌──────────▼────────┐  ┌───────▼──────────┐
            │ SSH Manager       │  │ guacd (optional)  │
            │ asyncssh          │  │ RDP / VNC proxy   │
            │ SFTP / shell      │  │ Apache Guacamole  │
            └───────────────────┘  └──────────────────┘
                       │
            ┌──────────▼────────┐
            │ SQLite (WAL mode) │
            │ Fernet encryption │
            └───────────────────┘
```

The server uses a multi-process architecture:
- **uvicorn workers** handle HTTP requests, REST APIs, and WebSocket connections
- A **dedicated SSH manager process** owns all SSH/SFTP connections and communicates with workers over a Unix domain socket using length-prefixed JSON IPC
- **guacd** (Apache Guacamole daemon, optional) handles RDP and VNC connections. The backend proxies the Guacamole protocol between the browser and guacd via WebSocket (`/ws/guacamole`)
- **SQLite** with WAL mode provides concurrent database access
- Stored credentials are encrypted with **Fernet** symmetric encryption derived from user passwords via PBKDF2

## License

[MIT](LICENSE)
