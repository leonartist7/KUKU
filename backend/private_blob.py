"""Private Blob adapter. Credentials stay on the API, never in app bundles or URLs."""
import os
from fastapi import HTTPException

class PrivateBlobStore:
    def ready(self):
        return bool(os.getenv("BLOB_READ_WRITE_TOKEN"))

    def require_config(self):
        if not self.ready():
            raise HTTPException(503, "File sharing is getting ready. Please try again later.")

    def put(self, key, file):
        self.require_config()
        from vercel.blob import sync as blob
        size = os.fstat(file.fileno()).st_size
        try:
            blob.put_blob(key, file, content_length=size, access="private",
                content_type="application/octet-stream", add_random_suffix=False, allow_overwrite=False)
        except Exception:
            # Provider error text can contain request details; never return it to callers.
            raise HTTPException(503, "Your file couldn’t be saved. Please try again.") from None

    def delete(self, key):
        self.require_config()
        from vercel.blob import sync as blob
        try:
            blob.delete_blob(key)
        except Exception:
            raise HTTPException(503, "Your file couldn’t be removed. Please try again.") from None

    def stream(self, key):
        self.require_config()
        from vercel import blob
        return blob.stream_blob(key, access="private")
