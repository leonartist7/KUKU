"""Small, re-encoded account photos; no external URLs or original metadata retained."""
import base64
import binascii
import io
import warnings
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_BASE64 = 4 * ((MAX_INPUT_BYTES + 2) // 3)

def normalize_photo(encoded):
    if encoded is None:
        return None
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_INPUT_BYTES:
            raise ValueError("size")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as photo:
                if photo.width * photo.height > 16_000_000:
                    raise ValueError("dimensions")
                photo.load()
                photo = ImageOps.exif_transpose(photo)
                photo = ImageOps.fit(photo, (256, 256), method=Image.Resampling.LANCZOS).convert("RGBA")
                flat = Image.new("RGB", photo.size, "#FBF9F6")
                flat.paste(photo, mask=photo.getchannel("A"))
                # A fresh image drops EXIF, GPS, ICC and all source metadata.
                output = io.BytesIO()
                flat.save(output, format="JPEG", quality=82, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except (ValueError, binascii.Error, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "Choose a JPEG, PNG or WebP photo under 2 MB and 16 megapixels")
