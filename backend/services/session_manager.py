"""Active session lifecycle manager."""

from datetime import datetime, timezone
from typing import Any, Optional


class ActiveSessionManager:
    """Tracks which users have which active connections.

    Maps user IDs to their active tabs/sessions, enabling session
    limits, lookups, and cleanup.
    """

    def __init__(self):
        self._user_sessions: dict[str, dict[str, dict[str, Any]]] = {}

    def register_session(
        self,
        user_id: str,
        tab_id: str,
        connection_id: str,
        session_type: str,
    ) -> None:
        """Register a new active session for a user.

        Args:
            user_id: The user's ID.
            tab_id: Unique identifier for the browser tab or session tab.
            connection_id: The SSH/SFTP connection ID.
            session_type: Type of session (e.g. "ssh", "sftp").
        """
        if user_id not in self._user_sessions:
            self._user_sessions[user_id] = {}

        self._user_sessions[user_id][tab_id] = {
            "connection_id": connection_id,
            "session_type": session_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def unregister_session(self, user_id: str, tab_id: str) -> None:
        """Remove an active session for a user.

        Args:
            user_id: The user's ID.
            tab_id: The tab identifier to remove.
        """
        if user_id in self._user_sessions:
            self._user_sessions[user_id].pop(tab_id, None)
            if not self._user_sessions[user_id]:
                del self._user_sessions[user_id]

    def get_user_sessions(self, user_id: str) -> list[dict[str, Any]]:
        """Get all active sessions for a user.

        Args:
            user_id: The user's ID.

        Returns:
            A list of session info dicts, each containing tab_id,
            connection_id, session_type, and created_at.
        """
        sessions = self._user_sessions.get(user_id, {})
        return [
            {"tab_id": tab_id, **info}
            for tab_id, info in sessions.items()
        ]

    def get_connection_id(self, user_id: str, tab_id: str) -> Optional[str]:
        """Look up the connection ID for a specific user tab.

        Args:
            user_id: The user's ID.
            tab_id: The tab identifier.

        Returns:
            The connection_id if found, otherwise None.
        """
        sessions = self._user_sessions.get(user_id, {})
        session = sessions.get(tab_id)
        if session is not None:
            return session["connection_id"]
        return None

    def unregister_by_connection_id(self, connection_id: str) -> None:
        """Remove an active session by its connection ID.

        Searches all users/tabs for a matching connection_id and removes
        the entry.  No-op if the connection_id is not found.

        Args:
            connection_id: The connection ID to look up and remove.
        """
        for user_id, tabs in self._user_sessions.items():
            for tab_id, info in tabs.items():
                if info["connection_id"] == connection_id:
                    tabs.pop(tab_id)
                    if not tabs:
                        del self._user_sessions[user_id]
                    return

    def has_capacity(self, user_id: str, max_sessions: int) -> bool:
        """Check if a user can open more sessions.

        Args:
            user_id: The user's ID.
            max_sessions: Maximum number of concurrent sessions allowed.

        Returns:
            True if the user has fewer than max_sessions active, False otherwise.
        """
        current_count = len(self._user_sessions.get(user_id, {}))
        return current_count < max_sessions


session_manager = ActiveSessionManager()
