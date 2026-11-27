# Animated emotes for KUKU

Research checked 3 November 2026. This is a researched implementation recommendation; no emote picker or third-party artwork has been shipped by this change.

## Recommended collections

| Collection | Visual direction | Source format | License / inclusion requirement | Fit for KUKU |
| --- | --- | --- | --- | --- |
| [Microsoft Fluent Emoji Animated](https://github.com/microsoft/fluentui-emoji-animated) | Soft, sculpted, dimensional characters | 256×256 animated PNG | [MIT](https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE); retain Microsoft copyright and full license notice in redistributed assets | First choice for a premium 3D emote pack |
| [Google Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/) | Expressive, playful 2D characters | Animated WebP, GIF and Lottie JSON | [Official docs](https://googlefonts.github.io/noto-emoji-files/?view=docs) identify CC BY 4.0 for the animations; credit Google/Noto, link the source and license, identify conversions/changes | First choice for a lighter, illustrated pack |

The Noto animation license is distinct from licenses on Noto fonts or other static artwork. Use the official animation documentation, not third-party directories that label every Noto asset Apache/OFL. Microsoft's animated repository has its own MIT license. Neither collection requires a paid sticker service or subscription.

## Proposed first pack

Choose one visual family for consistency. Start with approximately 16 emotions: hello/wave, warm smile, laughing, heart eyes, heart, hug, kiss, tears of joy, happy tears, thinking, sleepy, surprise, thumbs up, celebration, fire and sparkles. Confirm availability and expression in the source collection before final selection. My recommendation is Fluent for the first 3D pack and Noto as an optional later illustrated pack.

## Implementation approach

1. Download only the selected assets in cloud CI from a pinned upstream revision. Microsoft's repository warns that a full clone occupies approximately 10 GB; do not clone the full collection or install its cache locally.
2. Convert selected APNGs into transparent animated WebP for the web app, keeping a separate static poster for accessibility and unsupported native animation paths. Noto's supplied WebP files may be used directly after measuring size. Keep attribution, source revision, original checksum, derived checksum, frame timing, and conversion settings in an asset manifest.
3. Aim for 128–160 px emotes, roughly 150 KiB per animation and a pack under 3 MiB; these are build targets, not measurements of the current upstream assets. Select or resize assets that exceed the budget. Do not distort timing or remove meaning to meet it.
4. Self-host the small approved pack with KUKU's static assets. Load the picker only when opened and animations only near the viewport. Avoid sending a third-party request for every private message. Pause/swap to static posters offscreen, in hidden tabs and when reduced motion is enabled. Use finite playback with tap-to-replay, rather than permanent loops throughout the conversation.
5. Add a small smile button beside the composer. Selecting an emote should first show a draft with clear Send/Cancel controls. Messages store only an allowlisted pack/item ID, not arbitrary remote URLs or large JSON payloads. Add server validation and leave existing messages compatible. Provide accessible names and preserve send retries/account isolation.
6. Render emotes without message cards or filenames, consistent with the new photo treatment. Keep emotes separate from private photo uploads: the current photo preview intentionally shows only the first frame of GIFs and is not an animation delivery system.
7. Add an accessible Credits screen and the required license/attribution files to both the web build and any later APK. Browser acceptance should verify actual animation frames, Send/Cancel, receiving-account rendering, reload, offline/error posters and reduced-motion behavior before calling the feature shipped.

## Performance references

[Google's WebP documentation](https://developers.google.com/speed/webp/) explains support for transparent and animated WebP and its compression benefits. It does not guarantee a fixed reduction for every asset. Compare actual source and derived sizes and visually review frame quality before inclusion. No Lottie player dependency is necessary for an initial WebP pack; a later Lottie implementation could give finer playback controls if native requirements justify it.
