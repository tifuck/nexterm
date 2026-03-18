"""Import/export sessions (MobaXterm, etc.)."""
import json
import logging
import configparser
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.models.session import SavedSession, SessionType
from backend.models.folder import Folder
from backend.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import", tags=["import"])


def parse_mobaxterm_sessions(content: str) -> list[dict]:
    """Parse MobaXterm .mxtsessions file format.
    
    MobaXterm uses an INI-like format:
    [Bookmarks]
    SubRep=FolderName
    ImgNum=41
    
    [Bookmarks_1]
    SubRep=FolderName\\SubFolder
    ImgNum=41
    SSH_Host=192.168.1.1
    ...
    """
    sessions = []
    folders_seen = set()
    
    config = configparser.ConfigParser(strict=False)
    config.read_string(content)
    
    for section in config.sections():
        if not section.startswith("Bookmarks"):
            continue
        
        items = dict(config.items(section))
        
        # Determine session type and extract connection details
        session_data = {
            "name": section.replace("Bookmarks_", "Session "),
            "folder_path": items.get("subrep", ""),
            "session_type": "ssh",
            "host": "",
            "port": 22,
            "username": "",
        }
        
        # Check for different protocol indicators
        if "ssh_host" in items or "#109#" in items.get("imgnum", ""):
            session_data["session_type"] = "ssh"
            session_data["host"] = items.get("ssh_host", items.get("hostname", ""))
            session_data["port"] = int(items.get("ssh_port", items.get("port", 22)))
            session_data["username"] = items.get("ssh_user", items.get("username", ""))
        elif "rdp_host" in items or "#91#" in items.get("imgnum", ""):
            session_data["session_type"] = "rdp"
            session_data["host"] = items.get("rdp_host", items.get("hostname", ""))
            session_data["port"] = int(items.get("rdp_port", items.get("port", 3389)))
            session_data["username"] = items.get("rdp_user", items.get("username", ""))
        elif "vnc_host" in items or "#strVNC" in str(items):
            session_data["session_type"] = "vnc"
            session_data["host"] = items.get("vnc_host", items.get("hostname", ""))
            session_data["port"] = int(items.get("vnc_port", items.get("port", 5900)))
        elif "ftp_host" in items:
            session_data["session_type"] = "ftp"
            session_data["host"] = items.get("ftp_host", items.get("hostname", ""))
            session_data["port"] = int(items.get("ftp_port", items.get("port", 21)))
            session_data["username"] = items.get("ftp_user", items.get("username", ""))
        elif "telnet_host" in items:
            session_data["session_type"] = "telnet"
            session_data["host"] = items.get("telnet_host", items.get("hostname", ""))
            session_data["port"] = int(items.get("telnet_port", items.get("port", 23)))
        
        # Also try generic hostname field
        if not session_data["host"]:
            session_data["host"] = items.get("hostname", "")
        if not session_data["username"]:
            session_data["username"] = items.get("username", "")
        
        # Extract name from the section or subrep
        if "sessionname" in items:
            session_data["name"] = items["sessionname"]
        elif session_data["host"]:
            session_data["name"] = session_data["host"]
        
        # Track folder paths
        if session_data["folder_path"]:
            folders_seen.add(session_data["folder_path"])
        
        # Only add if we have a host
        if session_data["host"]:
            sessions.append(session_data)
    
    return sessions


@router.post("/mobaxterm")
async def import_mobaxterm(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import sessions from MobaXterm .mxtsessions file."""
    MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

    try:
        content = await file.read(MAX_IMPORT_FILE_SIZE + 1)
        if len(content) > MAX_IMPORT_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Import file too large. Maximum size is {MAX_IMPORT_FILE_SIZE // (1024 * 1024)} MB",
            )
        text = content.decode("utf-8", errors="replace")
        
        parsed_sessions = parse_mobaxterm_sessions(text)
        
        if not parsed_sessions:
            raise HTTPException(status_code=400, detail="No sessions found in file")
        
        # Create folders
        folder_map = {}  # path -> folder_id
        for session_data in parsed_sessions:
            folder_path = session_data.get("folder_path", "")
            if folder_path and folder_path not in folder_map:
                # Create nested folders
                parts = folder_path.replace("\\", "/").split("/")
                parent_id = None
                current_path = ""
                for part in parts:
                    if not part:
                        continue
                    current_path = f"{current_path}/{part}" if current_path else part
                    if current_path not in folder_map:
                        folder = Folder(
                            user_id=current_user.id,
                            parent_id=parent_id,
                            name=part,
                        )
                        db.add(folder)
                        await db.flush()
                        folder_map[current_path] = folder.id
                    parent_id = folder_map[current_path]
        
        # Create sessions
        created = []
        for session_data in parsed_sessions:
            session_type_map = {
                "ssh": SessionType.SSH,
                "rdp": SessionType.RDP,
                "vnc": SessionType.VNC,
                "telnet": SessionType.TELNET,
                "ftp": SessionType.FTP,
            }
            
            folder_id = None
            folder_path = session_data.get("folder_path", "").replace("\\", "/")
            if folder_path and folder_path in folder_map:
                folder_id = folder_map[folder_path]
            
            session = SavedSession(
                user_id=current_user.id,
                folder_id=folder_id,
                name=session_data["name"],
                session_type=session_type_map.get(session_data["session_type"], SessionType.SSH),
                host=session_data["host"],
                port=session_data["port"],
                username=session_data.get("username", ""),
            )
            db.add(session)
            created.append(session_data["name"])
        
        await db.flush()
        
        return {
            "message": f"Imported {len(created)} sessions",
            "sessions": created,
            "folders_created": len(folder_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import error: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.get("/export")
async def export_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export all sessions as JSON."""
    from sqlalchemy import select
    
    result = await db.execute(
        select(SavedSession).where(SavedSession.user_id == current_user.id)
    )
    sessions = result.scalars().all()
    
    result = await db.execute(
        select(Folder).where(Folder.user_id == current_user.id)
    )
    folders = result.scalars().all()
    
    export_data = {
        "version": 1,
        "folders": [
            {
                "id": f.id,
                "name": f.name,
                "parent_id": f.parent_id,
                "color": f.color,
            }
            for f in folders
        ],
        "sessions": [
            {
                "name": s.name,
                "type": s.session_type.value,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folder_id": s.folder_id,
                "color": s.color,
                "icon": s.icon,
                "settings": s.settings_json,
            }
            for s in sessions
        ],
    }
    
    return export_data
