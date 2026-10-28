"""Account-owned blocking and private in-app reports."""
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from auth_service import now

async def blocked(db, a, b):
    return bool(await db.blocks.find_one({'$or': [
        {'owner_id': a, 'target_id': b}, {'owner_id': b, 'target_id': a}]}))

async def allow_direct(db, a, b):
    if await blocked(db, a, b):
        raise HTTPException(403, 'Direct contact is blocked')

class ReportIn(BaseModel):
    target_id: str = Field(max_length=100)
    message_id: str | None = Field(default=None, max_length=100)
    reason: Literal['spam', 'harassment', 'other']
    note: str = Field(default='', max_length=1000)

def safety_router(db_getter, auth):
    router = APIRouter()
    @router.get('/blocks')
    async def list_blocks(user=Depends(auth.verified)):
        rows = await db_getter().blocks.find({'owner_id': user['id']}).limit(200).to_list(200)
        result = []
        for row in rows:
            target = await db_getter().users.find_one({'id': row['target_id']})
            result.append({'id': row['target_id'], 'name': target['name'] if target else 'Deleted account'})
        return result

    @router.post('/blocks/{target_id}')
    async def block(target_id: str, user=Depends(auth.verified)):
        await auth.limit('block:' + user['id'], 30, 3600)
        if target_id == user['id']:
            raise HTTPException(400, 'Cannot block yourself')
        # Only an existing contact can be targeted; no account-directory oracle.
        related = await db_getter().chats.find_one({'members': {'$all': [user['id'], target_id]}})
        if not related and target_id not in await auth.contacts(user['id']):
            if await db_getter().blocks.find_one({'_id': user['id'] + ':' + target_id}):
                return {'ok': True}
            raise HTTPException(404, 'Contact not found')
        if await db_getter().blocks.count_documents({'owner_id': user['id']}) >= 200:
            raise HTTPException(400, 'Blocked contact limit reached')
        await db_getter().blocks.update_one({'_id': user['id'] + ':' + target_id},
            {'$setOnInsert': {'owner_id': user['id'], 'target_id': target_id, 'created_at': now()}}, upsert=True)
        return {'ok': True}

    @router.delete('/blocks/{target_id}')
    async def unblock(target_id: str, user=Depends(auth.verified)):
        await db_getter().blocks.delete_one({'_id': user['id'] + ':' + target_id})
        return {'ok': True}

    @router.post('/reports')
    async def report(payload: ReportIn, user=Depends(auth.verified)):
        await auth.limit('report:' + user['id'], 5, 86400)
        db = db_getter()
        chat = await db.chats.find_one({'members': {'$all': [user['id'], payload.target_id]}})
        if not chat or payload.target_id == user['id']:
            raise HTTPException(404, 'Conversation not found')
        if payload.message_id:
            message = await db.messages.find_one({'id': payload.message_id, 'sender_id': payload.target_id})
            if not message or not await db.chats.find_one({'id': message['chat_id'], 'members': user['id']}):
                raise HTTPException(404, 'Message not found')
        report_id = str(uuid.uuid4())
        await db.reports.insert_one({'id': report_id, 'reporter_id': user['id'],
            **payload.model_dump(), 'created_at': now(), 'status': 'pending'})
        return {'id': report_id, 'status': 'pending'}
    return router
