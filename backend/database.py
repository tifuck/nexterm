"""Database setup and session management."""
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, inspect, text
from backend.config import config

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


# Create async engine
engine = create_async_engine(
    config.database_url,
    echo=config.debug,
    pool_pre_ping=True,
)


# Enable WAL mode for SQLite
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Enable WAL mode and other SQLite optimizations."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


# Session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:
    """FastAPI dependency: yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def _sync_schema(conn):
    """Add any columns present in models but missing from existing tables.

    SQLAlchemy's ``create_all()`` creates new tables but never alters
    existing ones.  This function bridges that gap for SQLite by issuing
    ``ALTER TABLE … ADD COLUMN`` for every missing column, preventing
    errors when the schema has evolved since the database was first created.
    """
    inspector = inspect(conn)
    existing_tables = set(inspector.get_table_names())

    for table_name, table in Base.metadata.tables.items():
        if table_name not in existing_tables:
            # Table doesn't exist yet — create_all() will handle it.
            continue

        existing_cols = {col["name"] for col in inspector.get_columns(table_name)}

        for column in table.columns:
            if column.name in existing_cols:
                continue

            # Build the SQLite column type string.
            col_type = column.type.compile(dialect=conn.dialect)

            # Determine a suitable DEFAULT for the ALTER statement.
            # SQLite requires a default for NOT NULL columns added via ALTER.
            default_clause = ""
            if column.default is not None and column.default.is_scalar:
                default_val = column.default.arg
                if isinstance(default_val, str):
                    default_clause = f" DEFAULT '{default_val}'"
                elif isinstance(default_val, bool):
                    default_clause = f" DEFAULT {int(default_val)}"
                elif isinstance(default_val, (int, float)):
                    default_clause = f" DEFAULT {default_val}"
            elif not column.nullable and column.default is None:
                # NOT NULL column with no default — provide a safe zero-value
                # so SQLite can add it to rows that already exist.
                type_str = col_type.upper()
                if "INT" in type_str:
                    default_clause = " DEFAULT 0"
                elif "CHAR" in type_str or "TEXT" in type_str or "CLOB" in type_str:
                    default_clause = " DEFAULT ''"
                elif "REAL" in type_str or "FLOAT" in type_str or "DOUBLE" in type_str:
                    default_clause = " DEFAULT 0.0"
                elif "BOOL" in type_str:
                    default_clause = " DEFAULT 0"
                else:
                    default_clause = " DEFAULT ''"

            nullable = "" if column.nullable else " NOT NULL"

            ddl = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {col_type}{nullable}{default_clause}"
            logger.warning("Schema drift detected — adding missing column: %s", ddl)
            conn.execute(text(ddl))


async def init_db():
    """Create all database tables and add any missing columns."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_sync_schema)


async def close_db():
    """Close database engine."""
    await engine.dispose()
