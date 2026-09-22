# Launch material

## The LinkedIn post (main draft)

Post it as plain text, no link in the body — put links in the first comment. Two reasons: LinkedIn suppresses reach on
posts with outbound links, and a launch post for a slop filter must not itself read like slop. No broetry, no "Agree?",
no "comment YES". Specific claims only.

```text
I got tired of reading LinkedIn, so I built a filter for it.

Every post in your feed gets graded as you scroll: gold for a golden nugget, green for useful, red for slop. Click the
badge and it shows its work — the probability for each verdict, the signals that moved the score, and what the call cost
in tokens.

How it works, because this is the part I care about:

It asks TypeSafe's jev model 11 structured questions per post, in one call. One overall verdict, one information-density
score, nine yes/no signals (specificity, originality, actionable, promotional, engagement bait, AI boilerplate,
broetry, relevance, worth saving). The verdict itself is computed in code from those answers, using weights and
thresholds you can edit. The prompt produces evidence; the code decides.

That distinction matters. "An AI rates your feed" is useless if you can't see why, or argue with it. So your reader
profile — your interests, what you call slop, what you call a nugget — goes with every request, and every weight is a
slider in settings.

Two things I'll be honest about:

1. The hard part was not the model. It was LinkedIn's markup, which changed twice while I was building. Their
   server-driven feed wraps each item in a `display: contents` container: it has no box, so an IntersectionObserver
   never fires on it and posts were found but never graded. Discovery now has a path that ignores class names
   completely — it finds the Like/Comment/Repost row and walks up to the post.

2. It's a filter, not a judge. I've already disagreed with it more than once. The thresholds are yours.

v1 is out today. MIT, open source, on the Chrome Web Store and Firefox Add-ons. It runs on your own API key, and demo
mode grades posts with a local heuristic so you can try it with no key and no sign-up — nothing leaves your browser in
that mode.

Links in the first comment.
```

## First comment

```text
Install (Chrome / Firefox) and a 40-second demo: https://pikaryu729.github.io/deslopify/
Chrome Web Store: <link>  ·  Firefox Add-ons: <link>
Code + how the verdicts are computed: https://github.com/Pikaryu729/deslopify

No API key? There's a demo mode — one click, no account, nothing leaves your browser.
```

Fill in both store links before posting; the post itself says "on the Chrome Web Store and Firefox Add-ons".

## Alternative short post (if the long one feels like too much)

```text
I built a slop filter for LinkedIn.

Gold = golden nugget. Green = useful. Red = slop. As you scroll, with the reasoning shown when you click.

It asks TypeSafe's jev 11 structured questions per post in one call, then computes the verdict in code from those
answers using weights and thresholds you can edit. Your interests are part of the request, so the labels are yours, not
a generic average.

The interesting failure: LinkedIn's feed wraps items in `display: contents` containers, which have no box, so
IntersectionObserver never fired and posts were discovered but silently never graded. The fallback now finds the
Like/Comment/Repost row and walks up to the post, no class names required.

MIT, open source, Chrome + Firefox, runs on your own key — or try demo mode with no key and no network requests.
Code: https://github.com/Pikaryu729/deslopify
```

## Media to attach

Attach `assets/promo.mp4` (42s, 720p, silent) as a native LinkedIn video — it autoplays muted, and every beat carries
its own on-screen text. A recording outperforms a still on LinkedIn, and the extension's whole point is motion. Fall
back to `store/assets/screenshot-1-feed.png` only if the upload fails.

The demo beat is a real feed, so its post column is blurred: never post footage where a real person's name, face, or
post sits next to a "slop" label.

Alt text for the still:

```text
A LinkedIn feed with each post outlined in gold, green, or red, and a small badge in the author row of each post reading
"Nugget 90%", "Useful 83%", or "Slop 92%".
```

## Checklist before posting

- [ ] `npm run verify` is green, and the repo is pushed (`git status` clean).
- [ ] The release exists with both zips attached, so "install it" works from a cold start.
- [ ] `https://pikaryu729.github.io/deslopify/` loads on a phone as well as a desktop (LinkedIn mobile traffic is most
      of it).
- [ ] Someone who is not you has installed it once. The first-run path is: install → reload LinkedIn → banner offers
      demo mode → posts grade. Check that on a machine with no API key configured.
- [ ] Reply to early comments for the first hour; that is where the reach is.

## Things not to do

- Don't put the repo link in the post body (reach) or repeat it in every comment (spam).
- Don't claim it "detects AI-written posts". It flags AI *boilerplate* as one signal among eleven, and demo mode is a
  heuristic that will be wrong sometimes. Overclaiming is the fastest way to lose the technical audience you want.
- Don't post at the same time as a major news cycle if you can avoid it; scroll displacement on LinkedIn is real.
