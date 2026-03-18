"""SFTP file operations REST API."""
import logging
import mimetypes
import os
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from backend.middleware.auth import get_current_user, verify_token
from backend.database import async_session_factory
from backend.models.user import User
from backend.services.ssh_proxy import ssh_proxy

_bearer_scheme = HTTPBearer(auto_error=False)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sftp", tags=["sftp"])


async def _verify_connection(connection_id: str, current_user: User):
    """Verify the connection exists and belongs to the current user."""
    conn = await ssh_proxy.get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


@router.get("/{connection_id}/home")
async def get_home_directory(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get the home/starting directory for this SFTP session."""
    await _verify_connection(connection_id, current_user)

    try:
        await ssh_proxy.sftp_open(connection_id)
        home = await ssh_proxy.sftp_home(connection_id)
        return {"path": home}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP home directory error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get home directory")


@router.get("/{connection_id}/ls")
async def list_directory(
    connection_id: str,
    path: str = Query(default="/", description="Directory path"),
    current_user: User = Depends(get_current_user),
):
    """List directory contents via SFTP."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        entries = await ssh_proxy.sftp_ls(connection_id, path)
        return {"path": path, "entries": entries}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP ls error: {e}")
        raise HTTPException(status_code=500, detail="Failed to list directory")


@router.get("/{connection_id}/stat")
async def stat_file(
    connection_id: str,
    path: str = Query(description="File path"),
    current_user: User = Depends(get_current_user),
):
    """Get file/directory info."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        info = await ssh_proxy.sftp_stat(connection_id, path)
        return info
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP stat error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get file info")


@router.get("/{connection_id}/download")
async def download_file(
    connection_id: str,
    path: str = Query(description="File path to download"),
    current_user: User = Depends(get_current_user),
):
    """Download a file via SFTP."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        content = await ssh_proxy.sftp_read(connection_id, path)
        
        filename = path.split("/")[-1] if "/" in path else path
        
        return StreamingResponse(
            iter([content]),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(content)),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP download error: {e}")
        raise HTTPException(status_code=500, detail="Failed to download file")


# ---------------------------------------------------------------------------
# GET /preview -- serve a file inline for browser preview (images, audio, video, PDF)
# ---------------------------------------------------------------------------
@router.get("/{connection_id}/preview")
async def preview_file(
    connection_id: str,
    request: Request,
    path: str = Query(description="File path to preview"),
    token: str | None = Query(default=None, description="JWT token for inline auth"),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
):
    """Serve a file inline with the correct MIME type for browser preview."""
    # Authenticate via query-param token (for <img>/<video>/<audio>/<iframe>)
    # or via standard Authorization header.
    jwt_token = token
    if not jwt_token and credentials:
        jwt_token = credentials.credentials
    if not jwt_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_token(jwt_token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        current_user = result.scalar_one_or_none()

    if not current_user or not current_user.is_active:
        raise HTTPException(status_code=401, detail="User not found or disabled")

    await _verify_connection(connection_id, current_user)

    try:
        await ssh_proxy.sftp_open(connection_id)
        content = await ssh_proxy.sftp_read(connection_id, path)

        filename = path.split("/")[-1] if "/" in path else path
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        return StreamingResponse(
            iter([content]),
            media_type=mime_type,
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Content-Length": str(len(content)),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{connection_id}/read")
async def read_file(
    connection_id: str,
    path: str = Query(description="File path to read"),
    current_user: User = Depends(get_current_user),
):
    """Read file contents as text (for the editor)."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        content = await ssh_proxy.sftp_read(connection_id, path)
        
        # Try to decode as text
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = content.decode("latin-1")
            except Exception:
                raise HTTPException(status_code=400, detail="File is not text-readable")
        
        return {"path": path, "content": text, "size": len(content)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{connection_id}/upload")
async def upload_file(
    connection_id: str,
    path: str = Query(description="Destination directory path"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a file via SFTP."""
    await _verify_connection(connection_id, current_user)

    # Enforce a maximum upload size.  File content is base64-encoded when
    # sent over the IPC channel (16 MB limit), so the effective maximum
    # file size is ~10 MB after encoding overhead.
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

    try:
        await ssh_proxy.sftp_open(connection_id)

        # Read with size limit
        content = await file.read(MAX_UPLOAD_SIZE + 1)
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum upload size is {MAX_UPLOAD_SIZE // (1024 * 1024)} MB",
            )

        # Sanitise filename to prevent path traversal
        filename = os.path.basename(file.filename or "upload")
        if not filename or filename in (".", ".."):
            raise HTTPException(status_code=400, detail="Invalid filename")
        dest_path = f"{path.rstrip('/')}/{filename}"
        await ssh_proxy.sftp_write(connection_id, dest_path, content)
        return {"message": "File uploaded", "path": dest_path, "size": len(content)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


@router.post("/{connection_id}/save")
async def save_file(
    connection_id: str,
    path: str = Query(description="File path to save"),
    current_user: User = Depends(get_current_user),
    body: dict = None,
):
    """Save file contents (from the editor)."""
    await _verify_connection(connection_id, current_user)
    
    if not body or "content" not in body:
        raise HTTPException(status_code=400, detail="Missing 'content' in request body")
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        content = body["content"].encode("utf-8")
        await ssh_proxy.sftp_write(connection_id, path, content)
        return {"message": "File saved", "path": path, "size": len(content)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP save error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file")


@router.post("/{connection_id}/mkdir")
async def make_directory(
    connection_id: str,
    path: str = Query(description="Directory path to create"),
    current_user: User = Depends(get_current_user),
):
    """Create a directory via SFTP."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        await ssh_proxy.sftp_mkdir(connection_id, path)
        return {"message": "Directory created", "path": path}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP mkdir error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create directory")


@router.post("/{connection_id}/rename")
async def rename_item(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    body: dict = None,
):
    """Rename a file or directory."""
    await _verify_connection(connection_id, current_user)
    
    if not body or "old_path" not in body or "new_path" not in body:
        raise HTTPException(status_code=400, detail="Missing old_path or new_path")
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        await ssh_proxy.sftp_rename(connection_id, body["old_path"], body["new_path"])
        return {"message": "Renamed", "old_path": body["old_path"], "new_path": body["new_path"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP rename error: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename")


@router.delete("/{connection_id}/rm")
async def remove_item(
    connection_id: str,
    path: str = Query(description="Path to delete"),
    current_user: User = Depends(get_current_user),
):
    """Delete a file or directory."""
    await _verify_connection(connection_id, current_user)
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        await ssh_proxy.sftp_remove(connection_id, path)
        return {"message": "Deleted", "path": path}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP delete error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete")


@router.post("/{connection_id}/chmod")
async def change_permissions(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    body: dict = None,
):
    """Change file permissions."""
    await _verify_connection(connection_id, current_user)
    
    if not body or "path" not in body or "mode" not in body:
        raise HTTPException(status_code=400, detail="Missing path or mode")
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        mode = int(str(body["mode"]), 8) if isinstance(body["mode"], str) else body["mode"]
        await ssh_proxy.sftp_chmod(connection_id, body["path"], mode)
        return {"message": "Permissions changed", "path": body["path"], "mode": oct(mode)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SFTP chmod error: {e}")
        raise HTTPException(status_code=500, detail="Failed to change permissions")
