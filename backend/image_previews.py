"""Small, metadata-free image previews; originals remain unchanged and private."""
import base64
import io
import time
from collections import OrderedDict
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException

_cache = OrderedDict()
_cache_bytes = 0


def cached_preview(key):
    entry = _cache.get(key)
    if entry and entry[0] > time.monotonic():
        _cache.move_to_end(key)
        return entry[1]
    return None


def remember_preview(key, result):
    global _cache_bytes
    if key in _cache:
        _cache_bytes -= len(_cache.pop(key)[1]["image"])
    _cache[key] = (time.monotonic() + 60, result)
    _cache_bytes += len(result["image"])
    while _cache_bytes > 4 * 1024 * 1024 or len(_cache) > 128:
        _, old = _cache.popitem(last=False)
        _cache_bytes -= len(old[1]["image"])


def discard_previews(attachment_id):
    global _cache_bytes
    for key in list(_cache):
        if key[0] == attachment_id:
            _cache_bytes -= len(_cache.pop(key)[1]["image"])


def render_preview(raw, size, format="jpeg"):
    edge, limit = (512, 96 * 1024) if size == "thumb" else (1600, 480 * 1024)
    webp = format == "webp"
    if webp:
        limit = (48 if size == "thumb" else 320) * 1024
    try:
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP", "GIF", "BMP"]) as source:
            width, height = source.size
            pixels = width * height
            if min(width, height) < 1 or max(width, height) > 16000 or pixels > (32_000_000 if source.format == "JPEG" else 16_000_000):
                raise HTTPException(415, "This image is too large to preview. Download the original instead.")
            source.seek(0)
            source.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            oriented = ImageOps.exif_transpose(source)
            rgba = oriented.convert("RGBA")
            output = Image.new("RGBA" if webp else "RGB", rgba.size, (0, 0, 0, 0) if webp else "#F5F1E9")
            if webp:
                output.paste(rgba)
            else:
                output.paste(rgba, mask=rgba.getchannel("A"))
            rgba.close()
            oriented.close()
            try:
                for quality in (82, 66, 50, 40):
                    data = io.BytesIO()
                    if webp:
                        output.save(data, "WEBP", quality=quality, method=3)
                    else:
                        output.save(data, "JPEG", quality=quality, optimize=True)
                    if data.tell() <= limit:
                        return {"image": "data:image/" + ("webp" if webp else "jpeg") + ";base64," + base64.b64encode(data.getvalue()).decode(),
                            "width": output.width, "height": output.height}
                    output.thumbnail((max(1, int(output.width * .8)), max(1, int(output.height * .8))))
            finally:
                output.close()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        pass
    raise HTTPException(415, "No preview is available for this image. Download the original instead.")
