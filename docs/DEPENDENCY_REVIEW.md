# Dependency review — 4 November 2026

## Evidence and conclusion

The cloud npm audit --omit=dev JSON in kuku-review-20261104-third/dependency-audit.json reports **36 affected package records: 5 high, 30 moderate, 1 low, 0 critical**. This is an installed dependency-graph report, not proof that every affected function runs in the deployed app.

Reviewed frontend/package-lock.json blob: **26674d75c789f272bced0b5b8f974790ea450194**. The five high records reduce to **three underlying packages**: decode-uri-component, image-size and postcss. query-string and expo-router inherit the decoder finding. Multiple advisories can affect one underlying package.

**Recommendation:** test a narrowly scoped PostCSS repair and aligned Metro patch-line update in cloud CI. Keep the decoder finding explicitly unresolved until a compatible dependency upgrade or verified backport is available. Do not use npm audit fix --force: this report proposes Expo 51.0.39 and other SDK 58 packages against an SDK 54 app.

No dependency, lockfile or workflow was changed by this review. No local install/cache was created.

## Findings by actual boundary

| Installed package/path | Relevant exposure in this app | Repair candidate and confidence |
|---|---|---|
| decode-uri-component **0.2.2** ← query-string **7.1.3** ← expo-router **6.0.24** | Installed in the universal router graph. Exact SDK 54 source uses URL.searchParams for ordinary inbound route queries; queryString.parse is commented out. Outbound routing uses queryString.stringify. No exploited decoder path was demonstrated. This is narrower than saying the package is absent or universally unreachable. | Upstream fixed decoder **0.5.1** is ESM; query-string 7 requires a CommonJS callable. A blind override is not established as compatible. Defer to a supported router/SDK upgrade or separately verified backport. |
| image-size **1.2.1** ← metro **0.83.3** | Build-time asset dimension parsing. KUKU's uploaded chat images go to FastAPI/Pillow, not Metro. A malicious checked-in/build dependency image could still affect bundling. It is not an observed public upload-to-Node path. | Prefer aligned Metro **0.83.8**: upstream replaced image-size with internal parsers on the same 0.83 patch line. This avoids forcing image-size 1→2 API changes. |
| postcss **8.4.49** ← @expo/metro-config **54.0.17** | Build-time CSS processing. The deployed Vercel function is a JSON proxy using Node globals; it does not process CSS. No user-uploaded CSS-to-PostCSS runtime path was found. Build input remains relevant to the source-map/file-read advisories. | Patched floor for all listed PostCSS advisories is **8.5.23**. A pinned **8.5.31** override is a concrete same-major candidate, outside Expo's declared ~8.4.32 range; export/CSS/browser checks must establish compatibility. |

The app config uses web.output=single, producing a browser SPA. No Expo SSR handler is deployed. Package presence in dependencies therefore does not imply that all Expo CLI, Metro, codegen, Jest or filesystem utilities are part of a remotely reachable server handler. Conversely, static deployment does not eliminate vulnerable browser code when it is actually invoked.

### Why the decoder classification changed

The exact Expo SDK 54 tree at **12d6ea8d413e5bc80e8808cca52f47b146d44a90** declares expo-router 6.0.24, matching the lock. Its getStateFromPath delegates to the fork's parseQueryParams, which reads URL.searchParams. query-string 7.1.3 does contain the vulnerable decoder call when its own parse functions are used, so lockfile-only dismissal would also be wrong.

The maintained decoder advisory identifies0.5.1 as fixing the recent malformed-percent-input quadratic behavior. The0.5.1 package declares type=module; query-string 7.1.3 uses require('decode-uri-component') and calls the result. CommonJS/ESM behavior must be tested in Metro and any Node usage before substitution.

No malicious-input performance proof or complete bundle call-graph analysis was run in this review.

## Concrete cloud repair candidate

@expo/metro 54.2.0 pins **14 Metro packages to 0.83.3**, while Metro's own packages also pin one another. Keep the family aligned instead of upgrading only one nested copy.

Candidate package.json overrides:

```json
{
  "overrides": {
    "postcss": "8.5.31",
    "metro": "0.83.8",
    "metro-babel-transformer": "0.83.8",
    "metro-cache": "0.83.8",
    "metro-cache-key": "0.83.8",
    "metro-config": "0.83.8",
    "metro-core": "0.83.8",
    "metro-file-map": "0.83.8",
    "metro-minify-terser": "0.83.8",
    "metro-resolver": "0.83.8",
    "metro-runtime": "0.83.8",
    "metro-source-map": "0.83.8",
    "metro-symbolicate": "0.83.8",
    "metro-transform-plugins": "0.83.8",
    "metro-transform-worker": "0.83.8"
  }
}
```

This is a candidate, not an applied fix or a guarantee of Expo support. Upstream Metro 0.83.8 requires Node >= 20.19.4; the existing Node 22 CI line meets that engine requirement. Its package metadata omits image-size and its Assets.js imports the internal imageSize helper.

Validate the candidate in an isolated cloud checkout:

1. Confirm each exact 0.83.8 package and PostCSS 8.5.31 exists in the registry, then regenerate only the lock with package.json changes. Review the dependency diff; do not accept unrelated SDK jumps.
2. Run npm ci from that committed lock, TypeScript, existing unit suites and Expo web export. Recheck logo/fonts/images and generated CSS.
3. Run the browser journeys, including invitations with encoded fragments, route/query round trips, private image previews and current responsive layouts.
4. Run npm audit --omit=dev --json again and record the actual remaining findings. Confirm image-size is removed from the installed graph and PostCSS meets the patched floor; do not infer a clean audit from a successful build.

The decoder and its propagated router/query-string records may remain. Record that honestly rather than weakening an audit gate or claiming zero vulnerabilities.

## Other records in the supplied audit

- glob/minimatch, Babel/Jest/codegen, rimraf and Chromium launcher chains are mostly build/development tooling in this setup. Broad minimatch 3/9/10 → 11 overrides risk incompatible tool APIs and are not the first repair.
- uuid 3.4.0 arrives only through the direct @expo/ngrok 4.1.3 dependency in this lock. No production tunnel is configured. Remove unused ngrok or move it to development scope as a separate reviewed cleanup; that changes installation classification, not the vulnerability of a running tunnel.
- deepmerge 4.3.1 is a low-severity finding through Expo config. It remains a tracked tooling dependency, not a verified browser/profile merge endpoint.
- Existing audit counts are not erased by this classification. Reassess when adding SSR, server-side parsers, user-controlled build assets or native tooling.

## Primary sources

- [npm audit: meta-vulnerabilities and omitted dependency types](https://docs.npmjs.com/cli/v11/commands/npm-audit/)
- [Decoder maintainer advisory, patched 0.5.1](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-qr28-fpjm-wq7f)
- [Decoder0.5.1 package module format](https://github.com/SamVerschueren/decode-uri-component/blob/v0.5.1/package.json)
- [query-string 7.1.3 CommonJS import and parser](https://github.com/sindresorhus/query-string/blob/v7.1.3/index.js)
- [Exact Expo Router6.0.24 package declaration](https://github.com/expo/expo/blob/12d6ea8d413e5bc80e8808cca52f47b146d44a90/packages/expo-router/package.json)
- [SDK 54 inbound query parsing](https://github.com/expo/expo/blob/12d6ea8d413e5bc80e8808cca52f47b146d44a90/packages/expo-router/src/fork/getStateFromPath-forks.ts)
- [SDK 54 outbound routing](https://github.com/expo/expo/blob/12d6ea8d413e5bc80e8808cca52f47b146d44a90/packages/expo-router/src/fork/getPathFromState.ts)
- [Metro 0.83.8 official release](https://github.com/react/metro/releases/tag/v0.83.8)
- [Metro 0.83.8 package and engine](https://github.com/react/metro/blob/2ede29bc40f46dc27ac6ca4bac7a3da0d5c152b8/packages/metro/package.json)
- [Metro 0.83.8 internal asset parsing](https://github.com/react/metro/blob/2ede29bc40f46dc27ac6ca4bac7a3da0d5c152b8/packages/metro/src/Assets.js)
- [image-size ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
- [PostCSS source-map advisory and 8.5.23 floor](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp)
- [Official npm PostCSS versions](https://www.npmjs.com/package/postcss?activeTab=versions)
- [Official npm image-size versions](https://www.npmjs.com/package/image-size?activeTab=versions)

The old August report that image-size 2.0.3 was unpublished is stale: the official npm versions page now lists 2.0.3 and 2.0.4. That does not make a forced 1.x → 2.x substitution safe for Metro.
