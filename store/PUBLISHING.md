# Publishing Deslopify

Everything the two stores need that can be prepared in advance is already prepared. This document is the click-path
plus the exact text to paste into each form.

---

## 0. Pre-flight

| Thing | Status |
| --- | --- |
| Chrome Web Store packages | `npm run package` → `dist/artifacts/deslopify-chrome-<version>.zip` (manifest at archive root) |
| Firefox packages | `npm run build:firefox-xpi` → `dist/artifacts/deslopify-*.zip` |
| Mozilla validator | `npm run lint:firefox` → 0 errors, 0 warnings, 0 notices |
| Screenshots (1280×800 ×4) | `npm run store:assets` → `store/assets/` |
| Small promo tile (440×280) | `store/assets/promo-tile-440x280.png` |
| Marquee tile (1400×560, optional) | `store/assets/marquee-1400x560.png` |
| Store icon (128×128) | `store/assets/icon-128.png` |
| Privacy policy | **live** at <https://pikaryu729.github.io/deslopify/privacy.html> (generated from `PRIVACY.md` by `npm run build:site`) |
| Version | `package.json` only; `build.mjs` injects it into both manifests |
| License | MIT (`LICENSE`) |
| Reviewer path | demo mode: no key, no account, no network — see §1.5 |

The privacy policy URL to give both stores is:

```
https://pikaryu729.github.io/deslopify/privacy.html
```

That page is generated from `PRIVACY.md` and served by GitHub Pages from `main:/docs`, so editing the policy means
editing `PRIVACY.md` and running `npm run build:site`. Its contact section points at the repository's issue tracker;
swap in an email address there if you prefer.

You still need a **Chrome Web Store developer account** (one-time US$5, 2FA required) and a **Mozilla account** for AMO
(free).

**Demo mode already solves the reviewer problem.** A reviewer with no credentials sees one button — *Try demo mode* —
on the LinkedIn page and in the popup. One click grades posts locally: no key, no account, and no network requests at
all. Every verdict it produces is labelled "demo" in the verdict title, the explanation panel, and the popup, so a
reviewer cannot mistake it for the paid path. The test instructions in §1.5 lead with that.

---

## 1. Chrome Web Store

### 1.1 Upload

1. `npm run build && npm run package`
2. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Add new item**
3. Upload `dist/artifacts/deslopify-chrome-<version>.zip`
4. Fill the four tabs: **Store listing**, **Privacy**, **Distribution**, **Test instructions**

### 1.2 Store listing

- **Detailed description** (paste; first line is what users see first):

```
Deslopify grades every post in your LinkedIn feed as you scroll, so you can spend your attention where it is worth
spending.

Each post gets a coloured edge and a small badge: gold for a golden nugget, green for useful, red for slop. Click the
badge to see exactly why — the model's probability for each verdict, the signals that moved it (originality,
specificity, actionable, promotional, engagement bait, AI boilerplate, broetry, relevance, worth saving), the model
name, and the token cost.

WHAT MAKES IT DIFFERENT
· It tells you why, not just what. Every verdict is explainable and every weight is adjustable.
· The verdicts are tuned to you: your interests, your definition of slop, your definition of a nugget, all editable in
  settings and sent with each request.
· Thresholds, weights, and signal definitions are yours to change. No black box you have to trust.
· Works while you scroll. Posts are graded when they come into view, and verdicts are cached locally, so re-reading
  your feed costs nothing.

HOW IT WORKS
Deslopify reads the text of a post that is on your screen, asks an AI model you configure (TypeSafe's jev, or
Cloudflare Workers AI) a set of structured questions about it, and turns the answers into a verdict using thresholds
in the extension itself.

PRIVACY
No account, no analytics, no Deslopify servers. Post text is sent only to the provider you configure with your own API
key, and settings and verdicts stay in your browser. Full policy: https://pikaryu729.github.io/deslopify/privacy.html

BEFORE YOU INSTALL
You need an API key from TypeSafe (console.typesafe.ai) or a Cloudflare Workers AI token. The extension shows a clear
banner and a Test connection button so you can confirm it works before you scroll.
```

- **Category**: Productivity (secondary: Social Networking)
- **Language**: English (United States)
- **Store icon**: `store/assets/icon-128.png`
- **Screenshots**: `screenshot-1-feed.png`, `screenshot-2-explanation.png`, `screenshot-3-popup.png`,
  `screenshot-4-settings.png` (all 1280×800, in that order)
- **Small promo tile**: `store/assets/promo-tile-440x280.png`
- **Marquee promo tile**: `store/assets/marquee-1400x560.png` (optional)
- **Homepage URL**: `https://pikaryu729.github.io/deslopify/`
- **Support URL**: `https://github.com/Pikaryu729/deslopify/issues`

### 1.3 Privacy tab

The Privacy tab asks for one justification per permission, and the dashboard labels each box itself — paste only the
body text below, one box at a time. Note that Chrome lists `https://www.linkedin.com/*` as a host permission even
though it lives under `content_scripts.matches` in the manifest rather than `host_permissions`; it still needs a
justification.

**Single purpose description** (paste):

```
Deslopify does one thing: it reads posts that appear in the user's LinkedIn feed and labels each one as a golden
nugget, useful, or slop, using an AI model the user configures with their own API key.
```

**Permission `storage`** (paste):

```
Stores the user's own settings — their API key or Cloudflare token, thresholds, weights, and reader profile — and a
local cache of verdicts, so that re-scrolling the feed does not re-send anything to the API. The cache holds the
verdict and its token cost, keyed by a hash of the post, not a copy of the post text. Nothing leaves the browser
except the user's own credentials, attached to the requests they make to the provider they configured.
```

What is actually in extension storage, in case a reviewer asks: `deslopify:settings` (settings, including the API key),
`deslopify:cache:<hash>` (one verdict per post), `deslopify:stats` (counters and token totals), and `deslopify:tabs`
(per-tab progress). No `unlimitedStorage`, no `storage.sync`, no server.

**Host permission `https://www.linkedin.com/*`** (paste):

```
The extension's entire function is to read posts in the LinkedIn feed the user is viewing and draw a verdict badge on
them. Without this it cannot see a post, and it runs on no other site.
```

**Host permission `https://api.typesafe.ai/*`** (paste):

```
Default AI provider. When the user scrolls a post into view, the extension sends that post's text, its author name and
headline, and the reader profile from its own settings to this endpoint, using the API key the user supplied, and
displays the verdict it returns.
```

**Host permission `https://api.cloudflare.com/*`** (paste):

```
Alternative AI provider the user may select instead of TypeSafe, using their own Cloudflare account ID and API token.
Same request and same purpose as above.
```

_If a reviewer pushes back on a required host permission for an optional second provider, demote it: move
`https://api.cloudflare.com/*` to `optional_host_permissions` and request it from the options page when the user saves
Cloudflare credentials._

**Remote code**: select **"No, I am not using remote code."** All JavaScript ships in the package; the extension only
fetches JSON verdicts.

**Data usage**: check **Website content** and nothing else — the post text, its author name and headline, and the
reader profile are transmitted to the provider the user configured. The user's own personally identifying information,
health, financial, authentication, communications, location, web history, and user activity are *not* collected. Then
certify the limited-use statements.

**Privacy policy URL**: `https://pikaryu729.github.io/deslopify/privacy.html`.

### 1.4 Distribution

- Visibility: **Public** (or Unlisted while you test), all regions, free.

### 1.5 Test instructions

```
No account, no credentials, and no configuration are needed to test this extension.

1. Install it, then open https://www.linkedin.com/feed/ and log in (any account).
2. A banner appears saying a TypeSafe API key is required, with a button: "Try demo mode (no key)". Click it.
   (The same button is in the toolbar popup.)
3. Posts on screen are graded within a second, and the rest grade as you scroll. Each post gets a coloured left edge
   and a badge in the author row: gold = golden nugget, green = useful, red = slop.
4. Click a badge to open the explanation panel: the probability for each verdict, the signals that moved the score
   (originality, specificity, actionable, promotional, engagement bait, AI boilerplate, broetry, relevance, worth
   saving), the model name, and the token cost. In demo mode the panel and the verdict title are labelled "(demo)".
5. Settings (toolbar icon → Settings) shows every threshold and weight; the popup shows a per-tab status line and a
   Diagnostics button.

Demo mode is a local heuristic and makes NO network requests: with it on, the extension can be fully exercised
offline. To exercise the real model path, paste a TypeSafe API key (console.typesafe.ai) into Settings and press
"Test connection"; that path sends one request per post to the configured provider and nothing else.

Everything else the extension does is local: settings, the verdict cache, and counters live in extension storage.
```

### 1.6 Submit

**Submit for review**. Expect a few days, occasionally longer. You can defer publishing so you control the moment it
goes live.

---

## 2. Firefox (addons.mozilla.org)

### 2.1 Choose a channel

- **Listed** — public, searchable, reviewed by a human. Choose this to actually publish.
- **Unlisted** — signed but not listed; you distribute the `.xpi` yourself. Useful for a private rollout.

### 2.2 Submit

1. `npm run build && npm run build:firefox-xpi`
2. Go to <https://addons.mozilla.org/developers/> → **Submit a New Add-on** → choose the channel
3. Upload `dist/artifacts/deslopify_*.zip`
4. AMO validates it automatically (the same check `npm run lint:firefox` runs locally)

### 2.3 Listing answers

- **Name**: Deslopify — feed signal filter
- **Summary** (short): `Grades every post in your LinkedIn feed as a golden nugget, useful, or slop, as you scroll.`
- **Description**: reuse the Chrome detailed description above.
- **Category**: Productivity
- **Screenshots**: the four 1280×800 images in `store/assets/`
- **Privacy policy**: `https://pikaryu729.github.io/deslopify/privacy.html`
- **Data collection**: the manifest already declares
  `browser_specific_settings.gecko.data_collection_permissions.required = ["websiteContent"]`, which matches the policy.
  When asked what is transmitted, say: post text and author name/headline, sent to the AI provider the user configures
  with their own credentials.

### 2.4 Source code, if asked

AMO requires readable source and build instructions when a submission contains **generated, concatenated, or minified**
code. Deslopify's bundles are produced by esbuild, so a reviewer may ask. Have this ready:

```
Source: <link to the repository, or attach a zip of it>
Build: npm install && npm run build   (node >= 20; esbuild bundles src/ into dist/firefox)
The bundle is not minified: dist/firefox/background.js and content.js are plain, readable output of
esbuild with format=iife, and every source file is in src/.
```

---

## 3. Shipping an update

1. Bump `version` in **`package.json`** (both manifests take it from there — a test fails if they ever drift).
2. `npm run verify` (build + Mozilla lint + the whole test suite).
3. `npm run package && npm run build:firefox-xpi`.
4. Chrome: dashboard → your item → **Package** → upload → submit. Firefox: AMO → your add-on → **Upload New Version**.

Store rule to remember: **you cannot re-upload the same version number**, and a store-listed extension may not change
its meaning between updates — so ship behaviour changes as a version bump, never as a silent edit.

---

## 4. Risks worth knowing before you submit

- **Third-party trademarks.** The manifest name is deliberately *"Deslopify — feed signal filter"*: Chrome's
  [impersonation & IP policy](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)
  prohibits implying that a product is authorised by or produced by another company, and a brand in the extension name
  is the classic trigger. "LinkedIn" appears only in the description, descriptively. A test enforces this.
  (Revert by editing `name` in `src/manifest.base.json` if you disagree — but expect a review risk.)
- **LinkedIn's own terms.** Deslopify reads the DOM of a page the user already has open, in their own browser, and
  stores nothing on any server. That is the same posture as every feed-filtering extension, but it is not
  LinkedIn-endorsed, and their terms do prohibit automated scraping — keep it user-driven, and do not add features that
  walk the feed in the background.
- **"Single purpose" narrowness.** Do not add unrelated features (a general AI sidebar, a messaging tool) to the same
  extension; Chrome rejects those. New capability = new extension.
- **Reviewers cannot test without credentials.** See §1.5 — this is the most likely cause of a "not functional"
  rejection, and it has a one-line fix.
- **Cost transparency.** Users pay their own provider. Say so plainly in the listing (the draft above does), or reviews
  will punish you for it.
