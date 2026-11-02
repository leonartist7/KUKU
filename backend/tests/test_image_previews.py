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


def test_preview_resizes_orients_and_strips_metadata_without_changing_original():
    raw = photo(orientation=6)
    for size, edge in [("thumb", 512), ("full", 1600)]:
        result = render_preview(raw, size)
        assert result["width"] < result["height"] <= edge
        decoded = base64.b64decode(result["image"].split(",")[1])
        assert len(decoded) <= (96 if size == "thumb" else 480) * 1024
        with Image.open(io.BytesIO(decoded)) as preview:
            assert preview.format == "JPEG" and not preview.getexif()
        with Image.open(io.BytesIO(raw)) as original:
            assert original.size == (1800, 900) and original.getexif()[270] == "Private camera metadata"


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
