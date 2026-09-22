---
format: 1920x1080
duration: 42s
message: "Your LinkedIn feed, graded as you scroll — so you only read what's worth it"
arc: BAB — before (a feed full of slop) → bridge (Deslopify) → step 1 (graded feed) → step 2 (shows its work) → step 3 (yours to tune) → trust → CTA
audience: LinkedIn users tired of engagement bait — developers and builders first
mode: autonomous
music: none
captions: disabled
---

## Video direction

- **Silent film.** No voiceover, no music, no captions. Each frame's `voiceover` line below is the ON-SCREEN COPY cadence
  (the words the viewer reads, in the order they appear), not narration — workers pace reveals to it and may render those
  exact short phrases as the frame's motion-graphics copy. Every beat must read from the picture plus a few words.
- **Palette** from `frame.md`: canvas `bg` #0B0E13 · text #F2F4F7 · muted #9AA1AB · `primary` gold #F0B429 is the golden-nugget
  colour · `positive` green #2F9E6F is useful · `negative` red #D9534F is slop. Those three verdict colours are the whole
  visual language — they appear as pills, edges and dots exactly as the extension paints them. Cards are `card-tinted`
  (4% fill / 20% border / 14px radius, no shadow). Type is the system sans, `-apple-system` stack, weights 400/600/700.
- **Motion grammar**: long-tail `power3` settles, never bouncy. Reveal each piece on its copy cue, across the back half of
  the frame; nothing front-loads. Holds are still — at most a subtle jitter. Real screenshots are the product; never
  rebuild the LinkedIn feed in HTML. Screenshots sit in a `card-tinted` frame with a 1px border; no browser chrome drawn.
- **Rhythm**: F1 punches (fast), F2 breathes, F3–F5 are the working middle (each ends on a held read), F6 is the deliberate
  held breather, F7 lands and holds for the loop. Frames 1 and 7 both end on the same dark canvas so the muted autoplay
  loop seams cleanly.
- **Negative list**: no purple/blue "AI" gradients, no bokeh, no stock icons, no drop shadows, no fake cursor, no browser
  chrome, no sentence-length copy, no slideshow (dump-then-freeze), no screensaver (everything floating).

## Frame 1 — Stop reading slop

- scene: One bold line dead-centre on the dark canvas; the last word swaps in place — "slop" lands in red
- voiceover: "Stop reading — engagement bait. — AI filler. — humblebrags. — slop."
- duration: 4s
- poster: 3.4s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Pain validation
- beat: frustration → recognition
- blueprint: kinetic-type-beats (Reproduce — sub-shape A, fixed-line token swap)
- focal: none
- roles: none
- asset_candidates:

narrativeRole: name the pain in the viewer's own words before the product exists.
keyMessage: you already know most of your feed is noise.

Scene 1 (0.0–0.9s): bare `bg` canvas. "Stop reading" arrives centred via a per-word staggered reveal (a two-word stagger of the same `discrete-text-sequence` entrance), h1 scale, `text` colour. Centred, ~50% width. Camera locked.
Scene 2 (0.9–3.0s): the fixed line holds; a swap-slot after it hard-cuts (`discrete-text-sequence`) through "engagement bait." → "AI filler." → "humblebrags." at ~0.7s each, each in `text-muted`. No fade, no roll.
Scene 3 (3.0–4.0s): final token "slop." hard-cuts in, set in `negative` red at slightly larger scale with a left→right red underline (a plain scaleX tween from the left, transform-origin left). Holds still to the end.

## Frame 2 — Meet Deslopify

- scene: The icon blooms in at centre, the wordmark completes the lockup, the one-line promise types beneath
- voiceover: "Deslopify — your feed, graded as you scroll."
- duration: 4.5s
- poster: 3.8s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-intro.html
- type: product_intro
- persuasion: Friction reduction
- beat: relief + curiosity
- blueprint: logo-assemble-lockup (Adapt — mark spring-blooms whole, wordmark completes, tagline types)
- focal: assets/wordmark-dark.png
- roles: wordmark-dark = cutout · icon = supporting
- asset_candidates: assets/icon.png — the app icon, transparent; assets/wordmark-dark.png — mark + white "deslopify" lockup for dark backgrounds

narrativeRole: the bridge — name the product and land the promise by beat 2.
keyMessage: this grades the feed for you, while you scroll.

Adapt: keep the signature — the mark comes to exist on screen and resolves into a centred lockup; the "parts" are the icon then the wordmark, and the extension is a typed tagline instead of a URL.
Scene 1 (0.0–1.2s): `bg` canvas; a soft `primary` radial glow fades in behind centre (a plain opacity tween on a blurred radial-gradient disc, ≤ 12% opacity). The icon (assets/icon.png, ~22% of frame height) spring-pops from zero at centre with a smooth long-tail settle (`spring-pop-entrance`, no overshoot).
Scene 2 (1.2–2.4s): the icon slides left as the full wordmark (assets/wordmark-dark.png, ~55% of frame width, its own mark replaces the icon in place — the icon shrinks + fades at the same centre as the wordmark scales + fades in, so only one mark is visible at any moment) resolves centred. Lockup at rule-of-thirds upper band.
Scene 3 (2.4–4.5s): beneath the lockup, "your feed, graded as you scroll." types on with a caret (`discrete-text-sequence`; the caret is a plain stepped-opacity blink tween), h3 scale, `text-muted`; caret blinks twice then stops; hold still.

## Frame 3 — The graded feed

- scene: The real screen recording of the LinkedIn feed plays in a floating window while three verdict pills land beside it in gold, green, red
- voiceover: "Every post gets a verdict — golden nugget — useful — slop."
- duration: 14s
- poster: 12s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/03-demo.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: clarity
- blueprint: device-surface-showcase (Adapt — floating-window footage variant)
- focal: assets/demo-capture.mp4 (source 34.5s–48.5s)
- roles: demo-capture = footage
- asset_candidates: assets/demo-capture.mp4 — the user's own screen recording of the feed being graded as they scroll; the browser and OS chrome are cropped out

narrativeRole: step 1 — the core loop, shown on the real surface, with real scrolling.
keyMessage: three verdicts, painted on the feed itself.

Adapt: the window holds the recording (not a screenshot), so the content advances on its own — no synthetic scroll. The camera push stays on the copy column only.
Scene 1 (0.0–1.4s): `bg` canvas. The recording, inside a `card-tinted` window cropped to the LinkedIn page at 1.4×, slides up from below-centre into the right half of a 40/60 layout and settles (`power3`). "Every post gets a verdict" fades in as h2 in the left column, upper third.
Scene 2 (1.4–10s): the feed scrolls in the recording. Verdict pills mask-wipe into the left column at 2.0s / 5.5s / 9.0s: "golden nugget" (`primary`), "useful" (`positive`), "slop" (`negative`), accumulating as a vertical list.
Scene 3 (10–14s): hold — footage keeps playing, pills at rest, push stopped.

## Frame 4 — It shows its work

- scene: The explanation panel screenshot; the camera lands on it and three callouts tick in: probabilities, signals, cost
- voiceover: "Click a badge — the probabilities — the signals that moved it — what it cost."
- duration: 5.5s
- poster: 4.8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-explain.html
- type: feature_showcase
- persuasion: Transparency as trust
- beat: trust
- blueprint: device-surface-showcase (Adapt — static tour; one held window, callouts advance instead of screens)
- focal: assets/it-shows-its-work.png
- roles: it-shows-its-work = cutout
- asset_candidates: assets/it-shows-its-work.png — the feed with a post's explanation panel open: verdict distribution, signals, model, tokens

narrativeRole: step 2 — proof that the verdict is not a black box.
keyMessage: every verdict comes with its reasoning.

Adapt: keep the held-surface signature; the advancing beats are three callout chips that arrive beside the panel on their cues rather than screen swaps.
Scene 1 (0.0–1.3s): `bg` canvas. The screenshot enters in a `card-tinted` window filling ~62% width, offset left in a 60/40 layout, via a zoom-to-target (`coordinate-target-zoom`) that lands framed on the open explanation panel — one move, then locked. "Click a badge" h2 fades in top-right.
Scene 2 (1.3–4.4s): in the right column, three small `card-tinted` chips slide in one per cue with stagger (`center-outward-expansion`, short-path variant): "probabilities" with three tiny stacked bars in gold/green/red filling (`stat-bars-and-fills`), "signals that moved it" with a 4-dot row, "token cost" with a small mono number. Each chip's leading border is `primary`.
Scene 3 (4.4–5.5s): hold still. At most a subtle jitter on nothing — the frame reads.

## Frame 5 — Yours to tune

- scene: The settings page screenshot behind an accumulating list of three things you control
- voiceover: "Yours to tune — raise the bar for a nugget — collapse slop — your own key, your own weights."
- duration: 5.5s
- poster: 4.8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-tune.html
- type: benefit_highlight
- persuasion: Feature-to-benefit translation
- beat: control
- blueprint: grid-card-assemble (Reproduce — Benefits vertical-list, BUILD sub-mode)
- focal: assets/deslopify-settings-provider-and-api-key-.png
- roles: deslopify-settings-provider-and-api-key- = background (dim ~40%)
- asset_candidates: assets/deslopify-settings-provider-and-api-key-.png — the settings page: provider, API key, thresholds and weights

narrativeRole: step 3 — the verdicts are the viewer's, not ours.
keyMessage: every threshold and weight is yours.

Scene 1 (0.0–1.2s): the settings screenshot sits full-bleed right, tilted 3D page-card (`3d-page-scroll`, one slow internal scroll, tilt ~8°), dimmed ~40% behind a `bg` gradient veil on the left half. "Yours to tune" h2 fades in top-left.
Scene 2 (1.2–4.5s): a vertical list builds beneath the h2, ~1 item/sec (`grid-card-assemble` BUILD): each line = a small `primary` marker that spring-pops (`spring-pop-entrance`, smooth) + a check that draws in (`svg-path-draw`) + the text mask-wipes: "raise the bar for a nugget" → "collapse slop" → "your own key, your own weights". Left 45%, layered-depth against the tilted page.
Scene 3 (4.5–5.5s): the page's internal scroll rests; the list holds; still.

## Frame 6 — Nothing to trust but your own key

- scene: Calm title card, three short lines only: no account · no analytics · no server of ours
- voiceover: "No account. — No analytics. — No server of ours. — Free and open source."
- duration: 4s
- poster: 3.4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-privacy.html
- type: social_proof
- persuasion: Risk reversal
- beat: peace of mind
- blueprint: titlecard-reveal (Reproduce — the calm breather)
- focal: none
- roles: none
- asset_candidates:

narrativeRole: the held breather before the ask — remove the last objection.
keyMessage: nothing leaves your browser except the post you are already reading, to a key you own.

Scene 1 (0.0–0.4s): bare `bg` canvas, static camera.
Scene 2 (0.4–2.8s): the ONE move — a centred stack slides up + crossfades in (`dynamic-content-sequencing`, per-line stagger): "No account." / "No analytics." / "No server of ours." as h2 in `text`, each line landing on its cue with a hairline `border` rule between; then a small `tag-pill` "free & open source" fades in beneath in `primary`.
Scene 3 (2.8–4.0s): hold to the end. Nothing moves.

## Frame 7 — Install it

- scene: The lockup returns at centre, two browser pills beneath it, and the site URL wipes in gold
- voiceover: "Deslopify — Chrome · Firefox — pikaryu729.github.io/deslopify"
- duration: 5s
- poster: 4.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Friction reduction
- beat: urgency-to-act → confidence
- blueprint: logo-assemble-lockup (Adapt — already-assembled lockup settles, extended to a URL end card)
- focal: assets/wordmark-dark.png
- roles: wordmark-dark = cutout
- asset_candidates: assets/wordmark-dark.png — mark + white "deslopify" lockup for dark backgrounds

narrativeRole: the ask, and the loop's landing frame.
keyMessage: it takes one install; here is where.

Adapt: keep the signature — the lockup resolves centred and extends into a URL end card; no camera push-through (the loop must land quiet).
Scene 1 (0.0–1.2s): `bg` canvas; the wordmark (assets/wordmark-dark.png, ~48% width) settles into the upper-centre from a slight scale-down + fade (`spring-pop-entrance`, smooth). A soft `primary` radial glow fades in behind it (plain opacity tween on a blurred radial-gradient disc, ≤ 12%).
Scene 2 (1.2–2.6s): two `tag-pill`s slide in beneath, staggered (`center-outward-expansion`): "Chrome" and "Firefox" — outlined, `text` on transparent, 1px `border`.
Scene 3 (2.6–5.0s): the URL "pikaryu729.github.io/deslopify" reveals left→right beneath the pills via clip-path wipe in `primary` gold, then flips to `text` white on the final beat (`grid-card-assemble` URL reveal coda), mono-ish tracking. Everything holds dead still for the last ~1.6s so the loop back to Frame 1's dark canvas is quiet.
