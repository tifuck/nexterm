"""SFTP file operations REST API."""
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.services.ssh_proxy import ssh_proxy

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
    except Exception as e:
        logger.error(f"SFTP home directory error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        logger.error(f"SFTP ls error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
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
    
    try:
        await ssh_proxy.sftp_open(connection_id)
        content = await file.read()
        dest_path = f"{path.rstrip('/')}/{file.filename}"
        await ssh_proxy.sftp_write(connection_id, dest_path, content)
        return {"message": "File uploaded", "path": dest_path, "size": len(content)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
