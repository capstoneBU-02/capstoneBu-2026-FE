# Self-hosted design fonts

Retrieved on 2026-11-01. No font package or runtime CDN dependency is required.

## Design evidence

The Figma Plugin API returned these exact families, styles, and weights for [the workspace](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-139) and [the consent dialog](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=75-1399), except JetBrains Mono Bold, which comes from the board below:

| Family         | Figma styles          | CSS weights   | Use                               |
| -------------- | --------------------- | ------------- | --------------------------------- |
| Noto Sans KR   | Regular, Medium, Bold | 400, 500, 700 | Korean UI                         |
| JetBrains Mono | Regular, Medium, Bold | 400, 500, 700 | Times, tester code, and tab frets |
| Geist          | SemiBold              | 600           | Wordmark                          |

JetBrains Mono Bold is the `Mono/Tab` text style, JetBrains Mono Bold 13/16, on [the Foundations board](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1651). The tab draws its fret numbers in it.

Figma supplied font metadata, not font binaries. The available Figma MCP asset exporter exposes rendered images, uploaded images, and SVG layers, but no font-file export. The bundled fonts are the same families from their official Google Fonts distribution. Figma does not expose an installed font binary version, so byte-for-byte equivalence with Figma's font files is not claimed.

## Official sources and licenses

- Noto Sans KR: [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/notosanskr), [OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt).
- JetBrains Mono: [JetBrains](https://www.jetbrains.com/lp/mono/), [source and OFL](https://github.com/JetBrains/JetBrainsMono).
- Geist: [Vercel](https://vercel.com/font), [source and OFL](https://github.com/vercel/geist-font).
- [Google Fonts CSS2 API](https://developers.google.com/fonts/docs/css2) documents variable weight ranges and font-display control.

The original license texts are preserved in `public/fonts/NotoSansKR-OFL.txt`, `public/fonts/JetBrainsMono-OFL.txt`, and `public/fonts/Geist-OFL.txt`. They are copied unchanged into the production build with the third-party notices.

## Download and selection

The following official CSS2 requests were fetched once during implementation with a current Chrome user-agent to obtain WOFF2:

```text
https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400..700&display=swap
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400..500&display=swap
https://fonts.googleapis.com/css2?family=Geist:wght@600&display=swap
```

The JetBrains Mono file served for the `400..500` request carries the font's whole 400–800 weight axis, read from its `fvar` table. The tab's Bold 700 therefore uses the same file unchanged, and `fonts.css` declares 400–700.

WOFF2 files are unmodified Google Fonts outputs, renamed locally. `sources.json` pins their exact `fonts.gstatic.com` URLs, byte counts, and SHA-256 hashes. The source URL's `v40` / `v24` / `v5` denotes the Google Fonts distribution revision, not an assertion about Figma's installed version.

| Family         | Files | Stored bytes | Included coverage                                                                                     |
| -------------- | ----: | -----------: | ----------------------------------------------------------------------------------------------------- |
| Noto Sans KR   |    90 |    1,989,640 | Official subsets intersecting Latin, Korean jamo, all 11,172 modern Hangul syllables, and punctuation |
| JetBrains Mono |     1 |       31,432 | Official Latin subset, normal variable weight axis 400–800                                            |
| Geist          |     1 |       13,372 | Official Latin subset, normal 600                                                                     |
| Total          |    92 |    2,034,444 | No italic assets                                                                                      |

Noto's official 124-subset stylesheet was reduced to the 90 subsets intersecting `U+0000–024F`, `U+1100–11FF`, `U+2000–206F`, `U+3130–318F`, `U+A960–A97F`, `U+AC00–D7FF`, or `U+FFA0–FFDC`. The retained font files and their original `unicode-range` values were not edited. This preserves all modern Hangul syllables for dynamic Korean song/section names rather than limiting Korean support to today's mock strings. Scripts outside this coverage may use the existing system fallback stack.

Variable Noto files serve the three requested UI weights through one shared resource per Unicode subset. JetBrains 400, 500, and 700 likewise share one resource. Declaring only the needed ranges avoids separate static files for every weight.

### Tab PDF export — 2026-11-14

jsPDF embeds TrueType only, so the tab's PDF export carries JetBrains Mono as two static TTF files, fetched once from the official CSS2 API with a non-WOFF2 user-agent:

```text
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700
```

| File                     |   Bytes | Weight | Use                                         |
| ------------------------ | ------: | -----: | ------------------------------------------- |
| `jetbrains-mono-400.ttf` | 112,172 |    400 | Tab PDF: string names, bar numbers, P.M., h |
| `jetbrains-mono-700.ttf` | 112,092 |    700 | Tab PDF: fret numbers (Mono/Tab)            |

They are unmodified Google Fonts outputs, renamed locally, pinned in `sources.json` with their `fonts.gstatic.com` URLs and SHA-256 hashes. They are not part of `fonts.css`: the export module imports them with `?url`, so the browser requests them only when a PDF is made. jsPDF writes only the glyphs used into the PDF. The PNG export inlines the WOFF2 above instead, since an SVG drawn into a canvas cannot reach the page's fonts.

## Loading and validation

`src/index.css` imports `fonts.css`; Vite resolves the relative font URLs into fingerprinted local assets. `font-display: swap` keeps text visible during loading. Existing line heights and component sizes remain explicit. The browser requests only subsets whose Unicode ranges occur on the rendered page; there are no global font preloads or external font requests.

Validation should include:

1. `document.fonts.ready` and `document.fonts.check` for all seven used family/weight combinations.
2. Browser-rendered font inspection for Korean text, monospace times, and the Geist wordmark, with a custom webfont selected rather than a system fallback.
3. Same-origin font responses, no failed font requests, and viewport overflow checks at 1440 and 390 pixels.
4. Default workspace and open consent dialog screenshots after fonts finish loading.

The collected UI source corpus intersects at most 15 files / 268,428 bytes including the two Latin fonts; this is a conservative source-text estimate, not a measured network transfer. The actual request count depends on the visible state, cache, and characters rendered.

### Browser verification — 2026-11-04

Isolated Chrome sessions with a disabled cache verified the 1440px and 390px workspace and consent dialog. CDP `CSS.getPlatformFontsForNode` confirmed custom webfonts for Korean UI, monospace times, the tester code, and the Geist wordmark; all six family/weight checks passed. Noto's variable font reports an internal family name containing `Thin`, while its selected Regular/Medium/Bold instances and computed weights are 400/500/700.

| Viewport | Initial font requests | Font response body bytes | Initial CLS | CLS with 1s font response delay |
| -------: | --------------------: | -----------------------: | ----------: | ------------------------------: |
|   1440px |                    12 |                  214,732 |    0.000239 |                        0.000259 |
|    390px |                    12 |                  214,732 |    0.000131 |                        0.000039 |

Opening the consent dialog loaded one additional Noto subset, bringing the total to 13 requests / 232,124 font response body bytes at both widths. No external requests, failed font responses, console errors, or document overflow were observed. These are local laboratory measurements, not field performance guarantees.

Detailed results and four screenshots are stored outside the FE repository under `../outputs/earmark-fonts-2026-11-04/`: `font-qa-result.json`, `workspace-fonts-1440.png`, `workspace-fonts-390.png`, `consent-fonts-1440.png`, and `consent-fonts-390.png`.
