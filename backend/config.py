"""Application configuration loader."""
import logging
import os
import secrets
import shutil
import yaml
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.yaml"
DEFAULT_CONFIG_PATH = BASE_DIR / "config.example.yaml"

# ---------------------------------------------------------------------------
# Environment variable prefix.  Any config property can be overridden by
# setting NEXTERM_<SECTION>_<KEY> (e.g. NEXTERM_APP_PORT=9000).  A small
# mapping below covers the most common Docker / CI overrides explicitly.
# ---------------------------------------------------------------------------
_ENV_PREFIX = "NEXTERM_"


class AppConfig:
    """Main application configuration."""

    def __init__(self):
        self._config = {}
        self._secret_key: str | None = None
        self.load()

    # -- helpers -----------------------------------------------------------

    def _env(self, env_key: str, default=None):
        """Read an environment variable with the NEXTERM_ prefix.

        Args:
            env_key: Suffix after NEXTERM_ (e.g. "APP_PORT").
            default: Fallback if the variable is unset or empty.

        Returns:
            The environment value as a string, or *default*.
        """
        val = os.environ.get(f"{_ENV_PREFIX}{env_key}", "").strip()
        return val if val else default

    def _env_bool(self, env_key: str, default=None):
        """Read an env var and coerce to bool (true/1/yes -> True)."""
        val = self._env(env_key)
        if val is None:
            return default
        return val.lower() in ("true", "1", "yes")

    def _env_int(self, env_key: str, default=None):
        """Read an env var and coerce to int."""
        val = self._env(env_key)
        if val is None:
            return default
        try:
            return int(val)
        except ValueError:
            return default

    # -- config file -------------------------------------------------------

    def _ensure_config_yaml(self):
        """Create config.yaml from example if it doesn't exist, with a real secret key."""
        if CONFIG_PATH.exists():
            return
        if DEFAULT_CONFIG_PATH.exists():
            shutil.copy2(DEFAULT_CONFIG_PATH, CONFIG_PATH)
            # Replace placeholder secret key with a real one
            text = CONFIG_PATH.read_text()
            real_key = secrets.token_hex(32)
            text = text.replace(
                "CHANGE_ME_TO_A_RANDOM_SECRET_KEY", real_key
            )
            CONFIG_PATH.write_text(text)

    def load(self):
        """Load config from config.yaml, creating it from the example if needed."""
        self._ensure_config_yaml()
        config_path = CONFIG_PATH if CONFIG_PATH.exists() else DEFAULT_CONFIG_PATH
        with open(config_path, "r") as f:
            self._config = yaml.safe_load(f) or {}
        # Reset cached secret key so it re-reads from new config
        self._secret_key = None

    def get(self, key_path: str, default=None):
        """Get a nested config value using dot notation (e.g., 'app.name')."""
        keys = key_path.split(".")
        value = self._config
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                return default
            if value is None:
                return default
        return value

    # -- App ---------------------------------------------------------------
    @property
    def app_name(self) -> str:
        return self._env("APP_NAME") or self.get("app.name", "TERMINAL")

    @property
    def host(self) -> str:
        return self._env("HOST") or self.get("app.host", "0.0.0.0")

    @property
    def port(self) -> int:
        return self._env_int("PORT") or self.get("app.port", 8443)

    @property
    def debug(self) -> bool:
        env = self._env_bool("DEBUG")
        if env is not None:
            return env
        return self.get("app.debug", False)

    @property
    def secret_key(self) -> str:
        if self._secret_key is not None:
            return self._secret_key
        key = self._env("SECRET_KEY") or self.get("app.secret_key", "")
        if not key or key == "CHANGE_ME_TO_A_RANDOM_SECRET_KEY":
            # Generate a real key and persist it to config.yaml so that
            # all workers share the same key and it survives restarts.
            key = secrets.token_hex(32)
            logger.warning(
                "No secret key configured — generated a new one. "
                "Set 'app.secret_key' in config.yaml to avoid key rotation on restart."
            )
            self._persist_secret_key(key)
        self._secret_key = key
        return key

    def _persist_secret_key(self, key: str) -> None:
        """Write the generated secret key back to config.yaml."""
        try:
            if CONFIG_PATH.exists():
                text = CONFIG_PATH.read_text()
                # Replace the placeholder or empty value
                import re
                text = re.sub(
                    r'(secret_key:\s*)(CHANGE_ME_TO_A_RANDOM_SECRET_KEY|""?|\'\'?|\s*$)',
                    rf'\g<1>"{key}"',
                    text,
                    count=1,
                    flags=re.MULTILINE,
                )
                CONFIG_PATH.write_text(text)
                logger.info("Secret key written to %s", CONFIG_PATH)
        except Exception as e:
            logger.error("Failed to persist secret key to config.yaml: %s", e)

    # -- Auth ----------------------------------------------------------------
    @property
    def registration_enabled(self) -> bool:
        env = self._env_bool("REGISTRATION_ENABLED")
        if env is not None:
            return env
        return self.get("auth.registration_enabled", True)

    @property
    def jwt_access_expire_minutes(self) -> int:
        return self._env_int("JWT_ACCESS_EXPIRE_MINUTES") or self.get("auth.jwt_access_token_expire_minutes", 60)

    @property
    def jwt_refresh_expire_days(self) -> int:
        return self._env_int("JWT_REFRESH_EXPIRE_DAYS") or self.get("auth.jwt_refresh_token_expire_days", 7)

    @property
    def max_login_attempts(self) -> int:
        return self._env_int("MAX_LOGIN_ATTEMPTS") or self.get("auth.max_login_attempts", 5)

    @property
    def lockout_duration_minutes(self) -> int:
        return self._env_int("LOCKOUT_DURATION_MINUTES") or self.get("auth.lockout_duration_minutes", 15)

    # -- Database ----------------------------------------------------------
    @property
    def database_url(self) -> str:
        url = self._env("DATABASE_URL") or self.get("database.url", "sqlite+aiosqlite:///data/nexterm.db")
        if url.startswith("sqlite") and ":///" in url:
            # Make relative paths absolute from BASE_DIR
            parts = url.split(":///", 1)
            if len(parts) == 2 and not parts[1].startswith("/"):
                db_path = BASE_DIR / parts[1]
                db_path.parent.mkdir(parents=True, exist_ok=True)
                url = f"{parts[0]}:///{db_path}"
        return url

    # -- HTTPS -------------------------------------------------------------
    @property
    def https_enabled(self) -> bool:
        env = self._env_bool("HTTPS_ENABLED")
        if env is not None:
            return env
        return self.get("https.enabled", True)

    @property
    def cert_file(self) -> str:
        path = self._env("CERT_FILE") or self.get("https.cert_file", "certs/server.crt")
        if not os.path.isabs(path):
            path = str(BASE_DIR / path)
        return path

    @property
    def key_file(self) -> str:
        path = self._env("KEY_FILE") or self.get("https.key_file", "certs/server.key")
        if not os.path.isabs(path):
            path = str(BASE_DIR / path)
        return path

    @property
    def auto_generate_cert(self) -> bool:
        env = self._env_bool("AUTO_GENERATE_CERT")
        if env is not None:
            return env
        return self.get("https.auto_generate_cert", True)

    # -- Encryption --------------------------------------------------------
    @property
    def kdf_iterations(self) -> int:
        return self._env_int("KDF_ITERATIONS") or self.get("encryption.kdf_iterations", 600000)

    # -- Sessions ----------------------------------------------------------
    @property
    def max_active_per_user(self) -> int:
        return self._env_int("MAX_ACTIVE_PER_USER") or self.get("sessions.max_active_per_user", 20)

    @property
    def keep_alive_minutes(self) -> int:
        return self._env_int("KEEP_ALIVE_MINUTES") or self.get("sessions.keep_alive_minutes", 30)

    @property
    def ssh_keepalive_interval(self) -> int:
        return self._env_int("SSH_KEEPALIVE_INTERVAL") or self.get("sessions.ssh_keepalive_interval", 60)

    # -- guacd -------------------------------------------------------------
    @property
    def guacd_enabled(self) -> bool:
        env = self._env_bool("GUACD_ENABLED")
        if env is not None:
            return env
        return self.get("guacd.enabled", False)

    @property
    def guacd_host(self) -> str:
        return self._env("GUACD_HOST") or self.get("guacd.host", "localhost")

    @property
    def guacd_port(self) -> int:
        return self._env_int("GUACD_PORT") or self.get("guacd.port", 4822)

    # -- AI ----------------------------------------------------------------
    @property
    def ai_enabled(self) -> bool:
        env = self._env_bool("AI_ENABLED")
        if env is not None:
            return env
        return self.get("ai.enabled", True)

    # -- Metrics -----------------------------------------------------------
    @property
    def metrics_enabled(self) -> bool:
        env = self._env_bool("METRICS_ENABLED")
        if env is not None:
            return env
        return self.get("metrics.enabled", True)

    @property
    def metrics_interval(self) -> int:
        return self._env_int("METRICS_INTERVAL") or self.get("metrics.interval_seconds", 5)

    # -- Deployment --------------------------------------------------------
    @property
    def deployment_mode(self) -> str:
        return self._env("DEPLOYMENT_MODE") or self.get("deployment.mode", "local")

    @property
    def allowed_origins(self) -> list:
        env = self._env("ALLOWED_ORIGINS")
        if env:
            return [o.strip() for o in env.split(",")]
        return self.get("deployment.allowed_origins", ["*"])

    @property
    def trusted_proxies(self) -> list:
        env = self._env("TRUSTED_PROXIES")
        if env:
            return [p.strip() for p in env.split(",")]
        return self.get("deployment.trusted_proxies", [])


# Singleton config instance
config = AppConfig()
