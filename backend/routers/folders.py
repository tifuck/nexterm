"""Folder CRUD routes."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.folder import Folder
from backend.models.session import SavedSession
from backend.models.user import User
from backend.schemas.folder import (
    FolderCreate,
    FolderResponse,
    FolderUpdate,
    ReorderItem,
)

router = APIRouter(prefix="/api/folders", tags=["folders"])


def _folder_to_response(f: Folder) -> FolderResponse:
    return FolderResponse(
        id=str(f.id),
        name=f.name,
        parent_id=str(f.parent_id) if f.parent_id else None,
        color=f.color,
        icon=f.icon,
        sort_order=f.sort_order,
        created_at=f.created_at,
        updated_at=f.updated_at,
    )


async def _get_folder_or_404(folder_id: str, user_id: str) -> Folder:
    async with async_session_factory() as db:
        result = await db.execute(
            select(Folder).where(Folder.id == folder_id)
        )
        folder = result.scalar_one_or_none()

    if folder is None or str(folder.user_id) != str(user_id):
        raise HTTPException(status_code=404, detail="Folder not found")

    return folder


@router.get("", response_model=list[FolderResponse])
async def list_folders(
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        result = await db.execute(
            select(Folder)
            .where(Folder.user_id == current_user.id)
            .order_by(Folder.sort_order, Folder.name)
        )
        folders = result.scalars().all()

    return [_folder_to_response(f) for f in folders]


@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(
    body: FolderCreate,
    current_user: User = Depends(get_current_user),
):
    if body.parent_id is not None:
        await _get_folder_or_404(body.parent_id, str(current_user.id))

    async with async_session_factory() as db:
        folder = Folder(
            user_id=current_user.id,
            name=body.name,
            parent_id=body.parent_id,
            color=body.color,
            icon=body.icon,
        )
        db.add(folder)
        await db.commit()
        await db.refresh(folder)

    return _folder_to_response(folder)


@router.put("/reorder", status_code=200)
async def reorder_folders(
    items: list[ReorderItem],
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        for item in items:
            result = await db.execute(
                select(Folder).where(Folder.id == item.id)
            )
            folder = result.scalar_one_or_none()

            if folder is None or str(folder.user_id) != str(current_user.id):
                continue

            folder.sort_order = item.sort_order

        await db.commit()

    return {"detail": "Folders reordered"}


@router.put("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: str,
    body: FolderUpdate,
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        result = await db.execute(
            select(Folder).where(Folder.id == folder_id)
        )
        folder = result.scalar_one_or_none()

        if folder is None or str(folder.user_id) != str(current_user.id):
            raise HTTPException(status_code=404, detail="Folder not found")

        update_data = body.model_dump(exclude_unset=True)

        if "parent_id" in update_data and update_data["parent_id"] is not None:
            if update_data["parent_id"] == folder_id:
                raise HTTPException(
                    status_code=400, detail="A folder cannot be its own parent"
                )
            await _get_folder_or_404(update_data["parent_id"], str(current_user.id))

        for field, value in update_data.items():
            if hasattr(folder, field):
                setattr(folder, field, value)

        folder.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(folder)

    return _folder_to_response(folder)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        result = await db.execute(
            select(Folder).where(Folder.id == folder_id)
        )
        folder = result.scalar_one_or_none()

        if folder is None or str(folder.user_id) != str(current_user.id):
            raise HTTPException(status_code=404, detail="Folder not found")

        # Nullify folder_id on sessions in this folder
        session_result = await db.execute(
            select(SavedSession).where(SavedSession.folder_id == folder_id)
        )
        for s in session_result.scalars().all():
            s.folder_id = None

        await db.delete(folder)
        await db.commit()
