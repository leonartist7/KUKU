# Private photo previews

Photos appear as thumbnails in conversations and Files. Tap a thumbnail to open a larger image, retry a failed preview, download the unchanged original, or delete your own upload. Images previously uploaded as ordinary files are recognized by filename and included in the Images category. The quick sharing composer also shows the chosen image before sending.

`GET /api/attachments/{id}/preview?size=thumb|full` returns a JPEG data URI and its dimensions through the authenticated JSON API. Every request checks verification, session, chat membership and whether the recipient was actually sent the attachment, including cache hits. Session and attachment access are checked again after rendering. Responses are not stored by the HTTP cache or service worker; the client does not persist previews in browser storage.

The server reads private object bytes and renders only JPEG, PNG, WebP, GIF and BMP. SVG and unsupported/corrupt formats show a download fallback. Preview generation corrects orientation, strips metadata and flattens transparency; animated images use their first frame. Original downloads preserve all original bytes and animation.

Thumbnails have a maximum edge of 512 pixels and 96 KiB; enlarged previews have a maximum edge of 1600 pixels and 480 KiB. Decoding accepts at most 32 million pixels for JPEG and 16 million for other formats, with a 16000-pixel dimension cap. One render runs at a time, with a 60-second in-memory cache bounded to 4 MiB and 128 entries. Browser thumbnails load near the visible area. Larger or unsupported originals remain downloadable.

Verification covers actual image decoding, orientation, metadata removal, size limits, unsigned/nonmember/unshared access, cached access after membership loss, verification loss, logout and deletion. Browser acceptance uploads JPEG bytes, checks selected/chat/Files previews, retries an enlarged preview and verifies that the original download is unchanged. Synthetic browser fixtures do not create real accounts or send email.
