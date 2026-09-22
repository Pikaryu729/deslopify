---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Your LinkedIn feed, graded as you scroll — so you only read what's worth it"
destination: website-embed
aspect: 1920x1080
language: en
audience: LinkedIn users who are tired of engagement bait — developers and builders first
length: 30s
angle: sell
narration: no
style_preset: blue-professional
---

## Intent

A short silent promo for Deslopify, a Chrome/Firefox extension that labels every LinkedIn post
golden nugget / useful / slop as you scroll. It plays muted, autoplaying, on the landing page hero
and as a preview in the README, so every beat has to read from the picture and a few words of
on-screen copy — no voiceover, no music. Confident, plain, developer-honest; no hype words.

## Assets

- ../../assets/icon.png — the app icon (dark navy squircle, feed card + funnel + sparkles); brand sting and CTA.
- ../../assets/wordmark-dark.png — the wordmark for dark backgrounds (mark + white "deslopify"); lockups.
- capture/assets/screenshot-1-feed.png — the real feed with gold/green/red edges and verdict badges; the demo beat.
- capture/assets/it-shows-its-work.png — the explanation panel (probabilities, signals, tokens); the proof beat.
- capture/assets/deslopify-settings-provider-and-api-key-.png — the settings page; the "yours to tune" beat.

## Customizations

- Silent: `music: none` and no `SCRIPT.md`. Reveal pacing follows the on-screen copy instead of a voiceover.
- Feature the captured screens as-is; don't rebuild the LinkedIn feed in HTML.
- End card carries the site URL pikaryu729.github.io/deslopify and "Chrome · Firefox".

## Notes

- Decided autonomously from "generate a promotional video … add it to the landing page and the README":
  sell (promo) not tour; 16:9 because the destinations are a website hero and a README; ~30s because a
  muted autoplay loop has to land fast; silent because there is no local TTS/music engine and the
  destinations autoplay muted anyway.
- Brand colours are the site's: canvas #0b0e13, raised #14181f, text #f2f4f7, muted #9aa1ab,
  nugget #f0b429, useful #2f9e6f, slop #d9534f. No purple/blue "AI" gradients.
