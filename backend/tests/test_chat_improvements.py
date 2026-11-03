import pytest
import server
from test_release import client, pair, headers

@pytest.mark.asyncio
async def test_emotes_are_allowlisted_private_and_idempotent(client):
    a,b,c,cid = await pair(client)
    endpoint = '/api/chats/'+cid+'/messages'
    body = {'chat_id':cid,'type':'emote','emote_id':'fluent:hug','client_message_id':'emote-1'}
    assert (await client.post(endpoint,json=body)).status_code == 401
    assert (await client.post(endpoint,headers=headers(c),json=body)).status_code == 404
    first = await client.post(endpoint,headers=headers(a),json=body)
    assert first.status_code == 200 and first.json()['emote_id'] == 'fluent:hug'
    assert (await client.post(endpoint,headers=headers(a),json=body)).json()['id'] == first.json()['id']
    assert (await client.post(endpoint,headers=headers(a),json={**body,'emote_id':'fluent:heart'})).status_code == 409
    received = (await client.get(endpoint,headers=headers(b))).json()
    assert received[-1]['emote_id'] == 'fluent:hug' and received[-1]['media'] is None
    for item in server.EMOTE_IDS:
        assert (await client.post(endpoint,headers=headers(a),json={**body,'emote_id':item,'client_message_id':None})).status_code == 200
    for bad in [None,'unknown','https://evil.example/emoji.webp','../../private']:
        assert (await client.post(endpoint,headers=headers(a),json={**body,'emote_id':bad,'client_message_id':None})).status_code == 400
    for extra in [{'text':'payload'},{'attachment_id':'file'},{'media':'https://evil.example'},{'space_id':'space'},{'duration_ms':1200}]:
        assert (await client.post(endpoint,headers=headers(a),json={**body,'client_message_id':None,**extra})).status_code == 400
    assert (await client.post(endpoint,headers=headers(a),json={'chat_id':cid,'type':'text','text':'hello','emote_id':'fluent:hug'})).status_code == 400
    await server.db.users.update_one({'id':b['user']['id']},{'$set':{'email_verified':False}})
    assert (await client.get(endpoint,headers=headers(b))).status_code == 403
