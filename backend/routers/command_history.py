"""Command history API for terminal autocomplete."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.command_history import CommandHistory
from backend.models.user import User
from backend.services.ssh_proxy import ssh_proxy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/history", tags=["command-history"])

MAX_HISTORY = 5000  # Max entries per user


@router.get("")
async def search_history(
    q: str = Query(default="", description="Search prefix or substring"),
    session_id: str | None = Query(default=None, description="Filter by session"),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
):
    """Search command history for autocomplete suggestions."""
    async with async_session_factory() as session:
        query = (
            select(CommandHistory.command, func.max(CommandHistory.created_at).label("last_used"))
            .where(CommandHistory.user_id == current_user.id)
        )
        if session_id:
            query = query.where(CommandHistory.session_id == session_id)
        if q:
            query = query.where(CommandHistory.command.ilike(f"{q}%"))

        # Group by command to deduplicate, order by most recent
        query = (
            query
            .group_by(CommandHistory.command)
            .order_by(func.max(CommandHistory.created_at).desc())
            .limit(limit)
        )

        result = await session.execute(query)
        rows = result.all()

    return {
        "commands": [{"command": row.command, "last_used": str(row.last_used)} for row in rows]
    }


@router.post("")
async def add_command(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """Record a command in history."""
    command = (body.get("command") or "").strip()
    if not command:
        return {"message": "Empty command ignored"}

    session_id = body.get("session_id")

    async with async_session_factory() as session:
        # Check if we need to trim old entries
        count_result = await session.execute(
            select(func.count())
            .select_from(CommandHistory)
            .where(CommandHistory.user_id == current_user.id)
        )
        count = count_result.scalar() or 0

        if count >= MAX_HISTORY:
            # Delete oldest entries to stay under limit
            oldest = await session.execute(
                select(CommandHistory.id)
                .where(CommandHistory.user_id == current_user.id)
                .order_by(CommandHistory.created_at.asc())
                .limit(count - MAX_HISTORY + 100)  # Delete 100 extra to avoid frequent trims
            )
            old_ids = [row.id for row in oldest.all()]
            if old_ids:
                from sqlalchemy import delete
                await session.execute(
                    delete(CommandHistory).where(CommandHistory.id.in_(old_ids))
                )

        entry = CommandHistory(
            user_id=current_user.id,
            session_id=session_id,
            command=command,
        )
        session.add(entry)
        await session.commit()

    return {"message": "Command recorded"}


@router.delete("")
async def clear_history(
    current_user: User = Depends(get_current_user),
):
    """Clear all command history for the current user."""
    from sqlalchemy import delete

    async with async_session_factory() as session:
        await session.execute(
            delete(CommandHistory).where(CommandHistory.user_id == current_user.id)
        )
        await session.commit()

    return {"message": "History cleared"}


# ---------------------------------------------------------------------------
# Remote shell history (fetched from the SSH server's history files)
# ---------------------------------------------------------------------------

# Shell script that reads common history files and outputs commands.
# - HISTFILE="" prevents the sub-shell from interfering with the user's
#   active history file.
# - Fish shell uses a YAML-like format; we extract the `cmd` lines.
_HISTORY_SCRIPT = r"""
HISTFILE=""
for f in ~/.bash_history ~/.zsh_history; do
    [ -f "$f" ] && tail -n {lines} "$f" 2>/dev/null
done
if [ -f ~/.local/share/fish/fish_history ]; then
    grep '^- cmd: ' ~/.local/share/fish/fish_history 2>/dev/null | tail -n {lines} | sed 's/^- cmd: //'
fi
"""


def _parse_history_output(raw: str) -> list[str]:
    """Parse raw history output into a deduplicated list of commands.

    Handles zsh extended-history format (: timestamp:0;command) and plain
    bash/fish formats.  Returns commands in most-recent-first order with
    duplicates removed (keeps the most recent occurrence).
    """
    seen: set[str] = set()
    commands: list[str] = []

    for line in reversed(raw.splitlines()):
        line = line.strip()
        if not line:
            continue

        # Zsh extended history format: ": <timestamp>:0;<command>"
        if line.startswith(": ") and ";;" not in line and ";" in line:
            idx = line.find(";")
            if idx != -1:
                line = line[idx + 1:]

        line = line.strip()
        if not line:
            continue

        # Skip multi-line continuations (lines starting with whitespace
        # that don't look like standalone commands)
        if line.startswith("\\"):
            continue

        if line not in seen:
            seen.add(line)
            commands.append(line)

    return commands


@router.get("/{connection_id}/remote")
async def get_remote_history(
    connection_id: str,
    lines: int = Query(default=500, ge=1, le=5000, description="Max lines to read per history file"),
    current_user: User = Depends(get_current_user),
):
    """Fetch shell history from the remote server's history files."""
    conn = await ssh_proxy.get_connection(connection_id)
    if conn is None or conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")

    script = _HISTORY_SCRIPT.replace("{lines}", str(lines))

    try:
        result = await ssh_proxy.run_command(connection_id, script, timeout=5)
        if "error" in result and result["error"]:
            logger.warning("Failed to fetch remote history for connection %s: %s", connection_id, result["error"])
            return {"commands": []}
        raw_output = result.get("stdout", "")
    except Exception as e:
        logger.warning("Failed to fetch remote history for connection %s: %s", connection_id, e)
        return {"commands": []}

    commands = _parse_history_output(raw_output)
    return {"commands": commands}
