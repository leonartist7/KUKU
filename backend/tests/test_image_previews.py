import base64
import io
import pytest
from PIL import Image
from fastapi import HTTPException
import server
from image_previews import render_preview
from test_release import client, pair, headers, private_files


def photo(size=(1800, 900), orientation=None):
    output = io.BytesIO()
    with Image.new("RGB", size, "#87A181") as image:
        exif = Image.Exif()
        exif[270] = "Private camera metadata"
        if orientation:
            exif[274] = orientation
        image.save(output, "JPEG", exif=exif)
    return output.getvalue()


@pytest.mark.parametrize("format", ["jpeg", "webp"])
def test_preview_resizes_orients_and_strips_metadata_without_changing_original(format):
    raw = photo(orientation=6)
    for size, edge in [("thumb", 512), ("full", 1600)]:
        result = render_preview(raw, size, format)
        assert result["width"] < result["height"] <= edge
        decoded = base64.b64decode(result["image"].split(",")[1])
        assert len(decoded) <= (96 if size == "thumb" else 480) * 1024
        with Image.open(io.BytesIO(decoded)) as preview:
            assert preview.format == format.upper() and not preview.getexif()
        with Image.open(io.BytesIO(raw)) as original:
            assert original.size == (1800, 900) and original.getexif()[270] == "Private camera metadata"


@pytest.mark.parametrize("size,edge,limit", [("thumb",512,48*1024),("full",1600,320*1024)])
def test_webp_preview_preserves_alpha_and_strips_metadata(size, edge, limit):
    raw = io.BytesIO()
    with Image.new("RGBA", (1800,900), (80,130,100,80)) as image:
        exif = Image.Exif(); exif[270] = "Private source metadata"
        image.save(raw, "PNG", exif=exif)
    result = render_preview(raw.getvalue(), size, "webp")
    assert result['image'].startswith('data:image/webp;base64,')
    decoded = base64.b64decode(result['image'].split(',')[1])
    assert len(decoded) <= limit and result['width'] <= edge
    with Image.open(io.BytesIO(decoded)) as image:
        assert image.format == 'WEBP' and image.mode == 'RGBA' and not image.getexif()
        assert image.getpixel((0,0))[3] == 80


@pytest.mark.parametrize("raw", [b"not a photo", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', photo((4200, 8000))])
def test_invalid_or_oversized_images_fall_back_to_download(raw):
    with pytest.raises(HTTPException) as error:
        render_preview(raw, "thumb")
    assert error.value.status_code == 415


@pytest.mark.asyncio
async def test_private_previews_require_sharing_and_recheck_access_on_warm_cache(client, private_files):
    a, b, c, cid = await pair(client)
    raw = photo()
    uploaded = await client.post('/api/chats/'+cid+'/attachments?name=family.jpg', headers=headers(a), content=raw)
    assert uploaded.status_code == 200
    fid = uploaded.json()['id']
    endpoint = '/api/attachments/'+fid+'/preview'
    assert (await client.get(endpoint)).status_code == 401
    assert (await client.get(endpoint, headers=headers(c))).status_code == 404
    assert (await client.get(endpoint, headers=headers(b))).status_code == 404
    assert (await client.get(endpoint, headers=headers(a))).status_code == 200
    # Legacy images uploaded as ordinary files must preview too.
    sent = await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json={'chat_id':cid,'type':'file','attachment_id':fid})
    assert sent.status_code == 200
    response = await client.get(endpoint+'?size=full', headers=headers(b))
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.json()['image'].startswith('data:image/jpeg;base64,')
    webp = await client.get(endpoint+'?format=webp', headers=headers(b))
    assert webp.status_code == 200 and webp.json()['image'].startswith('data:image/webp;base64,')
    # Old/native clients continue receiving JPEG after a WebP request warms the cache.
    assert (await client.get(endpoint, headers=headers(b))).json()['image'].startswith('data:image/jpeg;base64,')
    assert (await client.get(endpoint+'?format=svg', headers=headers(b))).status_code == 422
    assert (await client.get(endpoint+'?size=invalid', headers=headers(b))).status_code == 422
    assert list(private_files.data.values()) == [raw]
    # Cached bytes never bypass membership, verification, logout or deletion.
    await server.db.chats.update_one({'id':cid}, {'$pull':{'members':b['user']['id']}})
    assert (await client.get(endpoint, headers=headers(b))).status_code == 404
    await server.db.chats.update_one({'id':cid}, {'$push':{'members':b['user']['id']}})
    await client.post('/api/auth/logout', headers=headers(b))
    assert (await client.get(endpoint, headers=headers(b))).status_code == 401
    await server.db.users.update_one({'id':a['user']['id']}, {'$set':{'email_verified':False}})
    assert (await client.get(endpoint, headers=headers(a))).status_code == 403
    await server.db.users.update_one({'id':a['user']['id']}, {'$set':{'email_verified':True}})
    assert (await client.delete('/api/attachments/'+fid, headers=headers(a))).status_code == 200
    assert (await client.get(endpoint, headers=headers(a))).status_code == 404
    await client.post('/api/auth/logout', headers=headers(a))
    assert (await client.get(endpoint, headers=headers(a))).status_code == 401


@pytest.mark.asyncio
async def test_attachment_delete_publishes_durable_preview_revocation(client, private_files):
    sender, recipient, _, chat_id = await pair(client)
    uploaded = await client.post('/api/chats/'+chat_id+'/attachments?name=revoked.jpg',
        headers=headers(sender), content=photo((640, 480)))
    assert uploaded.status_code == 200
    attachment_id = uploaded.json()['id']
    sent = await client.post('/api/chats/'+chat_id+'/messages', headers=headers(sender),
        json={'chat_id':chat_id,'type':'image','attachment_id':attachment_id})
    assert sent.status_code == 200
    message_id = sent.json()['id']
    baseline = await client.get('/api/messages/sync', headers=headers(recipient))
    assert baseline.status_code == 200
    cursor = baseline.json()['cursor']

    removed = await client.delete('/api/attachments/'+attachment_id, headers=headers(sender))
    assert removed.status_code == 200
    replay = (await client.get('/api/messages/sync?after='+str(cursor), headers=headers(recipient))).json()
    matching = [event for event in replay['events'] if event['message_id'] == message_id]
    assert len(matching) == 1
    assert matching[0]['change'] == 'updated' and matching[0]['privacy_removal'] is True
    resolved = await client.post('/api/chats/'+chat_id+'/messages/resolve', headers=headers(recipient),
        json={'message_ids':[message_id]})
    assert resolved.status_code == 200
    assert resolved.json()[0]['attachment_deleted'] is True
    assert resolved.json()[0]['revision'] == 1
    assert (await client.get('/api/attachments/'+attachment_id+'/preview', headers=headers(recipient))).status_code == 404
