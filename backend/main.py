"""Main FastAPI application entry point."""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.config import config
from backend.database import init_db, close_db
from backend.utils.cert import generate_self_signed_cert
from backend.services.ssh_proxy import ssh_proxy

# Import routers
from backend.routers.auth import router as auth_router
from backend.routers.sessions import router as sessions_router
from backend.routers.folders import router as folders_router
from backend.routers.sftp import router as sftp_router
from backend.routers.import_export import router as import_router
from backend.routers.import_sessions import router as import_sessions_router
from backend.routers.ai import router as ai_router
from backend.routers.api_keys import router as api_keys_router
from backend.routers.command_history import router as history_router
from backend.routers.tools import router as tools_router
from backend.routers.known_hosts import router as known_hosts_router

# Import WebSocket handlers
from backend.websocket.ssh_ws import ssh_websocket_handler
from backend.websocket.metrics_ws import metrics_websocket_handler
from backend.websocket.sftp_ws import sftp_progress_handler
from backend.websocket.tools_ws import tools_websocket_handler

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if config.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("nexterm")
logging.getLogger("asyncssh").setLevel(logging.WARNING)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info(f"Starting {config.app_name} on port {config.port}")
    
    # Ensure data directory exists
    (BASE_DIR / "data").mkdir(exist_ok=True)
    
    # Generate self-signed cert if needed
    if config.https_enabled and config.auto_generate_cert:
        cert_path = Path(config.cert_file)
        key_path = Path(config.key_file)
        if not cert_path.exists() or not key_path.exists():
            logger.info("Generating self-signed SSL certificate...")
            generate_self_signed_cert(str(cert_path), str(key_path))
    
    # Initialize database
    await init_db()
    logger.info("Database initialized")
    
    # Connect to the dedicated SSH manager process via IPC.
    # The SSH process is started by run.py before uvicorn launches.
    await ssh_proxy.connect_to_process()
    logger.info("Connected to SSH manager process")
    
    yield
    
    # Shutdown
    await ssh_proxy.close()
    await close_db()
    logger.info(f"{config.app_name} stopped")


# Create FastAPI app
app = FastAPI(
    title=config.app_name,
    description="Web-based remote access client — SSH, SFTP, RDP, VNC, Telnet, FTP",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs" if config.debug else None,
    redoc_url="/api/redoc" if config.debug else None,
)

# CORS middleware
# When allowed_origins is ["*"], restrict to same-origin only for security.
# Explicitly configure origins in config.yaml for cross-origin access.
_origins = config.allowed_origins
if _origins == ["*"]:
    # Wildcard with credentials is dangerous — restrict to no cross-origin.
    # Users must explicitly list allowed origins in config.yaml.
    _origins = []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to every HTTP response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; "
                "font-src 'self' data:; "
                "connect-src 'self' ws: wss:; "
                "frame-ancestors 'none'"
            ),
        )
        if config.https_enabled:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)


# Register API routers
app.include_router(auth_router)
app.include_router(import_sessions_router)  # Must be before sessions_router (shares /api/sessions prefix)
app.include_router(sessions_router)
app.include_router(folders_router)
app.include_router(sftp_router)
app.include_router(import_router)
app.include_router(ai_router)
app.include_router(api_keys_router)
app.include_router(history_router)
app.include_router(tools_router)
app.include_router(known_hosts_router)

# WebSocket endpoints
app.websocket("/ws/ssh")(ssh_websocket_handler)
app.websocket("/ws/metrics")(metrics_websocket_handler)
app.websocket("/ws/sftp-progress")(sftp_progress_handler)
app.websocket("/ws/tools")(tools_websocket_handler)


# API config endpoint (public, used by frontend for app name and settings)
@app.get("/api/config")
async def get_public_config():
    """Return public application configuration."""
    return {
        "app_name": config.app_name,
        "registration_enabled": config.registration_enabled,
        "ai_enabled": config.ai_enabled,
        "metrics_enabled": config.metrics_enabled,
        "version": "0.1.0",
    }


# ---------------------------------------------------------------------------
# SPA fallback middleware — serves index.html for non-API, non-asset routes
# ---------------------------------------------------------------------------

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    class SPAFallbackMiddleware(BaseHTTPMiddleware):
        """Serve the React SPA for any route not handled by API/WS/assets."""

        async def dispatch(self, request: Request, call_next) -> Response:
            response = await call_next(request)
            path = request.url.path

            # Only intercept 404s for GET requests to non-API, non-WS, non-asset paths
            if (
                response.status_code == 404
                and request.method == "GET"
                and not path.startswith("/api/")
                and not path.startswith("/ws/")
                and not path.startswith("/assets/")
            ):
                return FileResponse(str(FRONTEND_DIR / "index.html"))

            return response

    app.add_middleware(SPAFallbackMiddleware)
