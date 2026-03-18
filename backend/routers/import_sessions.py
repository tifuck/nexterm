"""Session import routes."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.folder import Folder
from backend.models.session import SavedSession, SessionType
from backend.models.user import User
from backend.schemas.import_session import ImportPreview, ImportResult
from backend.services.import_service import parse_sessions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["import"])

SESSION_TYPE_MAP = {
    "ssh": SessionType.SSH,
    "rdp": SessionType.RDP,
    "vnc": SessionType.VNC,
    "telnet": SessionType.TELNET,
    "ftp": SessionType.FTP,
    "sftp": SessionType.SFTP,
}


# ---------------------------------------------------------------------------
# POST /import/preview — parse file and return preview without saving
# ---------------------------------------------------------------------------

@router.post("/import/preview", response_model=ImportPreview)
async def preview_import(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Parse an import file and return a preview of sessions without saving."""
    content = await _read_upload(file)
    filename = file.filename or "unknown"

    try:
        sessions, warnings, fmt = parse_sessions(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(sessions) > MAX_IMPORT_SESSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File contains {len(sessions)} sessions, maximum is {MAX_IMPORT_SESSIONS}",
        )

    return ImportPreview(
        format_detected=fmt,
        sessions=sessions,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# POST /import — parse file and create sessions + folders
# ---------------------------------------------------------------------------

@router.post("/import", response_model=ImportResult)
async def import_sessions(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Import sessions from an uploaded file.

    Parses the file, creates any needed folders, and creates sessions.
    Duplicate sessions (same name + host + port) are skipped.
    """
    content = await _read_upload(file)
    filename = file.filename or "unknown"

    try:
        parsed_sessions, warnings, fmt = parse_sessions(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(parsed_sessions) > MAX_IMPORT_SESSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File contains {len(parsed_sessions)} sessions, maximum is {MAX_IMPORT_SESSIONS}",
        )

    if not parsed_sessions:
        return ImportResult(warnings=warnings)

    sessions_created = 0
    folders_created = 0
    skipped = 0

    async with async_session_factory() as db:
        # Load existing sessions for duplicate detection
        result = await db.execute(
            select(SavedSession).where(SavedSession.user_id == current_user.id)
        )
        existing_sessions = result.scalars().all()
        existing_keys = {
            (s.name.lower(), s.host.lower(), s.port)
            for s in existing_sessions
        }

        # Load existing folders
        result = await db.execute(
            select(Folder).where(Folder.user_id == current_user.id)
        )
        existing_folders = result.scalars().all()

        # Build a lookup: folder name -> Folder object (for top-level folders)
        # and full path -> Folder id (for nested folders)
        folder_by_path: dict[str, str] = {}
        for f in existing_folders:
            # For now, use folder name as the path key for top-level folders
            if not f.parent_id:
                folder_by_path[f.name.lower()] = str(f.id)

        # Create folders from session folder_paths
        for ps in parsed_sessions:
            if not ps.folder_path:
                continue

            # Handle nested paths: "Parent/Child/GrandChild"
            path_parts = [p.strip() for p in ps.folder_path.split("/") if p.strip()]
            current_path = ""
            parent_id = None

            for part in path_parts:
                current_path = f"{current_path}/{part}" if current_path else part
                path_key = current_path.lower()

                if path_key not in folder_by_path:
                    folder = Folder(
                        user_id=current_user.id,
                        name=part,
                        parent_id=parent_id,
                    )
                    db.add(folder)
                    await db.flush()  # Get the generated ID
                    folder_by_path[path_key] = str(folder.id)
                    folders_created += 1

                parent_id = folder_by_path[path_key]

        # Create sessions
        for ps in parsed_sessions:
            key = (ps.name.lower(), ps.host.lower(), ps.port)
            if key in existing_keys:
                skipped += 1
                warnings.append(f"Skipped duplicate: {ps.name} ({ps.host}:{ps.port})")
                continue

            # Resolve folder_id from folder_path
            folder_id = None
            if ps.folder_path:
                path_parts = [p.strip() for p in ps.folder_path.split("/") if p.strip()]
                full_path = "/".join(path_parts).lower()
                folder_id = folder_by_path.get(full_path)

            # Map session type string to enum
            st = SESSION_TYPE_MAP.get(ps.session_type.lower(), SessionType.SSH)

            saved = SavedSession(
                user_id=current_user.id,
                folder_id=folder_id,
                name=ps.name,
                session_type=st,
                host=ps.host,
                port=ps.port,
                username=ps.username,
            )
            db.add(saved)
            existing_keys.add(key)
            sessions_created += 1

        await db.commit()

    return ImportResult(
        sessions_created=sessions_created,
        folders_created=folders_created,
        skipped=skipped,
        warnings=warnings,
    )


MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMPORT_SESSIONS = 1000


async def _read_upload(file: UploadFile) -> str:
    """Read and decode an uploaded file."""
    raw = await file.read(MAX_IMPORT_FILE_SIZE + 1)
    if len(raw) > MAX_IMPORT_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Import file too large. Maximum size is {MAX_IMPORT_FILE_SIZE // (1024 * 1024)} MB",
        )

    # Try UTF-8 first, fall back to latin-1 (covers Windows-1252/CP1252)
    for encoding in ("utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise HTTPException(status_code=400, detail="Could not decode file. Please ensure it is UTF-8 or Latin-1 encoded.")
