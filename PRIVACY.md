# Deslopify privacy policy

_Last updated: 2026-09-22_

Published at <https://pikaryu729.github.io/deslopify/privacy.html> — this is the URL to give to the Chrome Web Store and
addons.mozilla.org.

Deslopify is a browser extension that labels posts in your LinkedIn feed as a **golden nugget**, **useful**, or
**slop**, using an AI model that you configure.

Short version: Deslopify has no servers, no analytics, and no accounts. The only data that leaves your browser is the
text of a post, sent to the AI provider **you** chose and configured with **your own** API key.

## What Deslopify reads

To score a post, Deslopify reads the post's content from the LinkedIn page you have open:

- the post body text,
- the author's display name and headline,
- whether the post is promoted, suggested, a repost, contains media, contains an external link, or is collapsed
  behind "see more".

It reads nothing else. It does not read your messages, connections, profile, search history, other tabs, or other
websites. It does not run on any site other than `www.linkedin.com`.

## Where that data goes

When you scroll a post into view, Deslopify sends the fields above — together with the reader profile you typed into
its settings (your interests, what you consider slop, what you consider a golden nugget) — to the AI provider you
selected:

- **TypeSafe API** (`api.typesafe.ai`) — default, using your TypeSafe API key, or
- **Cloudflare Workers AI** (`api.cloudflare.com`) — using your Cloudflare account ID and API token, or
- **any endpoint URL you enter yourself** in the extension's advanced settings.

The provider returns a verdict, which Deslopify displays. That provider's own privacy policy governs what it does with
the request. Deslopify sends nothing to the extension's author, and there is no Deslopify server involved.

## What is stored, and where

Everything below stays in your browser's extension storage on your device:

- your settings, including your API key (so the extension can call your provider),
- a local cache of verdicts, keyed by a hash of the post and your settings, so re-scrolling does not re-send anything,
- counters such as how many posts were scored and how many tokens were used.

The cache holds verdicts and token counts, not copies of post text. You can clear it at any time from the popup or the
settings page ("Clear cache"), and removing the extension deletes all of it.

## Demo mode

Demo mode is off by default. When it is on, Deslopify grades posts with a small heuristic that runs entirely inside the
extension: **no API key is needed and no network requests are made at all** — nothing is sent anywhere, including to the
provider you may have configured. Verdicts produced this way are labelled "demo" wherever they appear, and turning demo
mode off restores normal grading.

## What Deslopify does not do

- No analytics, telemetry, crash reporting, or usage tracking.
- No advertising, no ad identifiers, no profiling.
- No selling or sharing of data with anyone other than the provider you configured.
- No remote code: every line of JavaScript runs from the extension package you installed.

## Your controls

- **Turn it off** — the popup toggle stops all reading and all requests immediately.
- **Point it somewhere else** — the provider and endpoint are yours to change, including a proxy you run.
- **Send less** — cap the characters sent per post in settings.
- **Delete everything** — clear the cache, or uninstall the extension.

## Children

Deslopify is a tool for adults using LinkedIn and is not directed at children.

## Changes

Material changes to this policy will be published with a new "last updated" date in the extension's repository and,
where required, noted in the extension's store listing.

## Contact

Questions, data requests, or complaints: open an issue at
<https://github.com/Pikaryu729/deslopify/issues> (add your email there if you would rather not use GitHub).
