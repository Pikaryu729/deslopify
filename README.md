<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.png" />
    <img src="assets/wordmark.png" alt="Deslopify" width="420" />
  </picture>
</p>

<p align="center">
  <a href="assets/promo.mp4"><img src="assets/promo.gif" alt="Forty-second promo: a LinkedIn feed graded as you scroll" width="720" /></a>
</p>

# Deslopify

A Chrome/Firefox extension that reads every post in your LinkedIn feed, asks [TypeSafe's
jev](https://docs.typesafe.ai/) model a set of structured questions about it, and paints the verdict on the post
as you scroll:

Site: <https://pikaryu729.github.io/deslopify/> · Privacy policy: <https://pikaryu729.github.io/deslopify/privacy.html>

| Colour | Verdict | Meaning |
| --- | --- | --- |
| 🟡 Gold | **Golden nugget** | Concrete, non-obvious, relevant — you'd save or share this. |
| 🟢 Green | **Useful** | Honest and on-topic, worth a skim, not a save. |
| 🔴 Red | **Slop** | Engagement bait, template/AI filler, humblebrag theatre, or an advert with nothing to take away. |

Each post gets a left edge in the verdict colour, a subtle tint (bottom-left), and a badge in the author row showing
the verdict plus confidence. Click the badge for the full breakdown: the model's probability distribution, the four
signals that moved the score, every signal with its value, the model name, and the token cost. Low-confidence calls
get a dashed edge and a `?`.

**No API key yet? Demo mode** grades posts with a small local heuristic — no key, no account, and no network requests
at all. Every verdict it produces is labelled "demo", and switching to real grading is one settings toggle. It exists
for two reasons: you can see what the extension does before signing up for a provider, and store reviewers can test it
without being handed a paid credential.

## How it works

1. A content script finds feed posts (`data-urn` / `feed-shared-update-v2` hooks, with class-substring and structural
   fallbacks), waits until one is ~35% on screen and stays there for 250 ms, then extracts author, headline, body text,
   quoted text (reposts), and flags (promoted, suggested, media-only, external link).
2. The background worker asks jev **once per post**: 11 questions in a single request — a `choice` for the overall
   verdict, a `score` for information density, and nine `noul`s for the atomic signals (originality, specificity,
   actionable, promotional, engagement bait, AI boilerplate, broetry, relevance to you, worth saving).
3. Code — not the model — turns those answers into the verdict (`src/shared/verdict.js`): a weighted, normalised score
   in `[-1, 1]`, three hard rules that can escalate a too-generous verdict to slop, and a relevance gate that raises
   the nugget bar for off-topic posts. This is the [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)
   pattern: keep judgements atomic, keep thresholds in your own code.
4. Verdicts are cached in `storage.local`, keyed by a digest of the post, your reader profile, the rubric version, the
   provider, and the weights. Re-scrolling your feed costs nothing.

The reader profile (your interests, what you call slop, what you call a nugget) is sent with every request, so the
verdicts reflect your taste rather than a generic notion of quality. Edit it in the settings page — it is the single
highest-leverage knob.

## Install

```bash
npm install
npm run build          # writes dist/chrome and dist/firefox
```

- **Chrome / Edge / Brave**: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → `dist/chrome`.
- **Firefox**: see [Installing on Firefox](#installing-on-firefox) below.

Or skip the build: download the packaged zips from the [latest release](https://github.com/Pikaryu729/deslopify/releases)
(`deslopify-chrome-*.zip` unzips to a folder you can load unpacked; the Firefox zip installs via *Load Temporary
Add-on*).

**Then reload your LinkedIn tab.** Content scripts only attach to pages loaded after the extension is installed, so a
feed tab that was already open is invisible to Deslopify until you refresh it. The popup says so if that is the case.

### Installing on Firefox

Firefox refuses to keep an unsigned extension installed in a normal release build, so pick one of these:

**A. Temporary add-on (works everywhere, vanishes when Firefox quits)**

1. `npm run build`
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
3. Select `dist/firefox/manifest.json` (or the packaged `dist/artifacts/*.zip` from `npm run build:firefox-xpi`).

You re-load it after each Firefox restart. Good for trying it out; tedious for daily use.

**B. Development loop with a real profile (`web-ext run`)**

```bash
npm run build
npm run dev:firefox          # opens Firefox with the add-on, reloads it as you rebuild
```

Add `--firefox-profile=<name-or-path>` to reuse a profile (so you stay logged into LinkedIn). **This does not work
with the snap build of Firefox** — snap confinement blocks the debug port and hides `web-ext`'s temp profile. Use
Mozilla's tarball/`.deb` build, or Firefox Developer Edition, for this route.

**C. Permanently installed (signed, no AMO listing)**

```bash
export WEB_EXT_API_KEY=...      # from addons.mozilla.org → Tools → Manage API Keys
npm run sign:firefox            # writes a signed .xpi to dist/artifacts/
```

Then install the `.xpi` from `about:addons` → gear icon → **Install Add-on From File…**. The unlisted channel is free
and not publicly listed; updates are manual. Alternatively, on Firefox **Developer Edition, Nightly or ESR** you can set
`xpinstall.signatures.required` to `false` in `about:config` and install the unsigned `.xpi` directly.

Requirements: Firefox **140+** (the manifest declares `data_collection_permissions`, which older versions do not
understand), Firefox for Android 142+.

Then open the extension's settings and pick a provider, **or press "Try demo mode"** in the popup to start with no
key at all:

- **TypeSafe API** (default): paste a key from <https://console.typesafe.ai/keys>. Model `jev-latest`.
- **Cloudflare Workers AI**: account ID + API token, model `typesafe/jev`.

Hit **Test connection** — it makes one tiny jev call and reports the responding model and latency.

## Settings worth knowing

- **Demo mode**: grade with a local heuristic — no API key, no network requests, verdicts labelled "demo".
- **Verdict tuning**: golden-nugget and slop thresholds, the stricter nugget bar for off-topic posts, and the
  low-confidence cut-off. Thresholds are in normalised score units; raise the nugget threshold if you want a stricter
  definition of "nugget".
- **Signal weights**: how much the model's own verdict, the quality signals, density, slop signals, and promotion
  count towards the score.
- **Feed behaviour**: badges, colour dot instead of a pill, fade slop, collapse slop behind a "show post" stub, max
  characters sent per post.
- **Rate limits and cache**: concurrency, requests per minute, cache size and TTL.

## Privacy

Post text (plus author name, headline, and the flags listed above) is sent to the provider *you* configured, and
nowhere else. No analytics, no Deslopify server, no other network calls. Keys live in browser extension storage.
Verdicts are cached locally so repeat views do not re-send anything. In demo mode the extension makes **no network
requests at all**. Firefox's manifest declares `data_collection_permissions.required = ["websiteContent"]` for exactly
this reason.

## Troubleshooting

Start by opening the popup. It reports, for the LinkedIn tab it can see: how many posts the content script found, how
many were scored, how many lacked text, whether credentials are configured, and any pending/failed calls. If that line
says *no Deslopify script on a LinkedIn tab*, the content script is not running there — reload the tab.

- **Nothing is highlighted, and the page shows a yellow banner**. That banner *is* the answer: either credentials are
  missing (it links to settings), or the page yielded no posts. In the second case, press **Copy diagnostics** — it
  copies a report with every discovery hook's match count, the real structure of your feed, and one sample post. That
  report is what turns "LinkedIn changed something" into a fix.
- **"Is the script even running?"** In DevTools, `document.documentElement.dataset.deslopifyStatus` is `"active"` on any
  page Deslopify is attached to, and `[data-deslopify]` counts scored posts. Starting the extension also logs one
  `[Deslopify] active on …` line to the console.
- **Everything says "Retry".** The badge tooltip carries the error. `401` → bad key. `422` → payload rejected. Repeated
  `429`/`529` are retried with backoff; lower *requests per minute* if you scroll fast through a long feed.
- **A corporate proxy or the API blocks extension requests.** Point *Endpoint* (in Advanced) at your own proxy that
  speaks the same request/response shape — the extension also supports Cloudflare Workers AI out of the box.
- **Verdicts feel off.** Change the reader profile first, then the thresholds. Each verdict's explanation panel shows
  which signals moved the score, so you can see whether it is a weight problem or a judgement problem.

### Why it keeps working when LinkedIn renames things

Discovery is layered, and the last layer needs no class names at all: Deslopify finds social action bars (the words
"Like / Comment / Repost / Send" next to an author profile link) and walks up to the smallest element that is a post.
Comments are told apart from posts by their action bar (a comment has *Reply*, not *Repost*). `test/dom/obfuscated.test.mjs`
and the e2e suite run the whole extension against a fixture whose every class name is a meaningless hash and which has no
`data-urn` anywhere, precisely so that class-name churn cannot silently disable it.

## Development

```
src/
  shared/      settings, rubric (the jev questions), verdict math, hashing, form binding
  background/  API adapters (TypeSafe + Cloudflare), retry/backoff, queue, cache, message router
  content/     post discovery/extraction, rendering (shadow DOM badge + panel), content.css
  popup/       toolbar popup: live per-tab status, counters, quick toggles
  options/     provider, reader profile, tuning, rate limits, cache
assets/        source logos (icon.png, wordmark.png) + the promo video; derived files via `npm run icons` / `npm run promo`
build.mjs      esbuild bundles per target + the Chrome/Firefox manifests
scripts/       icon + wordmark derivation, promo render + gif, store assets, site build
test/          unit, DOM (fixture in a real browser), e2e (real extension in Chromium)
videos/        the HyperFrames source of the promo video (storyboard + frame compositions)
```

Commands:

```bash
npm run build          # dist/chrome + dist/firefox
npm test               # unit + DOM + e2e
npm run test:unit      # verdict math, rubric shape, API adapters, cache keys, manifests
npm run test:dom       # extraction against LinkedIn-shaped markup in a real browser
npm run test:e2e       # the built extension in Chromium against a mock jev endpoint
npm run lint:firefox   # web-ext lint (AMO's validator)
npm run verify         # build + lint + all tests
npm run build:firefox-xpi  # package dist/artifacts/*.zip for Firefox
npm run dev:firefox    # web-ext run against dist/firefox
npm run serve:mock     # the mock jev API + fixture feed on localhost
npm run package        # store-ready zips for both stores (dist/artifacts)
npm run store:assets   # 1280x800 screenshots + promo tiles for the listings
```

Publishing is documented in [`store/PUBLISHING.md`](store/PUBLISHING.md): the exact click-path for both stores, the
copy to paste into each form, permission justifications, data-disclosure answers, and the review risks worth knowing.

Releasing an update is one command — [`store/RELEASING.md`](store/RELEASING.md) has the one-time credential setup:

```bash
npm run release:patch      # bumps the version, tags it, pushes; CI publishes to both stores
npm run release:rehearse   # runs the same pipeline without publishing
```

### What the tests actually cover

The test suite runs the **real built extension** in Chromium, with `www.linkedin.com` intercepted and served from
`test/fixtures/linkedin-feed.html`, and a mock jev endpoint that validates requests the way the documented API does
(required `state`/`model`/`questions`, per-primitive `criteria` shapes, Bearer auth) before answering with
jev-shaped payloads. The e2e suite proves: verdicts appear while scrolling, the highlight colours are the verdict
colours, badges and the explanation panel render, the payload is one call per post with all 11 questions, re-scrolling
is served from cache, a 429 is retried rather than dropped, a rejected key shows a retry badge instead of a wrong
verdict, the slop-collapse stub works, and the options/popup pages read and write real storage. The fixture page is
served with `style-src 'self'` (no `unsafe-inline`), so shadow-root badge styling is verified under a strict CSP.

The Firefox build is verified by `web-ext lint` (0 errors / 0 warnings) and by manifest contract tests; the Chrome and
Firefox builds differ only by `background.service_worker` vs `background.scripts`.

Failure modes are tested as features: a feed whose class names are all hashes still gets scored, a page with no posts at
all raises the on-page banner with a working **Copy diagnostics** button, and the content script is asserted to log no
errors during a full run.

### Known limits

- **The live API has not been exercised from here.** Every test runs against the mock endpoint; the payload shape is
  grounded in the official docs and asserted by the mock's validator, but a real key is needed for a live call.
  `Test connection` in settings is the one-click way to confirm it.
- **Real LinkedIn markup is not tested.** The extraction layer is built against fixtures that mimic LinkedIn's feed DOM
  (nested reposts, duplicated screen-reader names, clamped text, promoted and media-only posts) plus one whose class
  names are all opaque hashes, but LinkedIn ships changes constantly and can vary by account. The popup's per-tab status
  line, the on-page banner, and the `[Deslopify] active` console line exist so selector drift fails loudly instead of
  silently.
- Image-only and video-only posts are skipped (nothing to read); they get a neutral outline and no verdict.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with, endorsed by, or sponsored by LinkedIn Corporation or TypeSafe;
LinkedIn is a trademark of LinkedIn Corporation.
