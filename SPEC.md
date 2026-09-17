# mediamonkey factory — spec

Goal: an automated reel factory for instagram.com/mediamonkey.ai (157 posts, 0
followers: volume already failed, FORMAT is the rebuild). Output: ready-to-post
9:16 MP4 reels + captions, generated end to end on this machine for free.

## The format (every reel, 110-150s, 1080x1920, 30fps)
1. HOOK, 0-1.5s: one line of huge text + spoken punch ("your brain does this
   too and you can watch it happen"). The first frame must work as a thumbnail.
2. BODY: 3-5 rapid beats, each one surprising concrete fact or claim, spoken
   fast with word-by-word karaoke captions (big, bold, white with black stroke,
   one accent color for key words, max 3 words on screen at a time).
3. CTA, last 2s: "follow for the next one" variant, rotated from a list.

## Non-negotiable content rules (this is the moat, not a limitation)
- NO cloned celebrity/cartoon voices, NO copyrighted gameplay footage, NO
  copyrighted characters. Accounts built on those die by takedown; ours can't.
- Voice: Kokoro TTS stock voices (open source, on-device, small: exactly what
  the owner asked for). Give the persona ONE fixed voice for brand recognition
  (pick the most energetic of af_heart / af_bella / am_michael by listening).
- Backgrounds: three tiers, weighted in config.background.tiers, and every one
  of them is ours to post:
    physics 50%      self-generated seeded loops (procedural WebGL/canvas:
                     ring breakers, plinko, pong). We own every pixel, and a
                     single reel normally gets a FRESH seed nobody else has.
    harvested 35%    "oddly satisfying" stock under a licence that allows
                     commercial use (Pexels License today; YouTube CC BY when
                     it can be downloaded, credited automatically).
    publicDomain 15% NASA and Internet Archive.
  No gameplay, no shows, no characters, no scraped-from-a-feed footage. Every
  clip carries its licence string in assets/clips/sources.json, and a clip that
  requires attribution gets it appended to caption.txt automatically.
- Facts must be true. Script prompt requires a source-checkable claim per beat;
  never invented numbers (same rule as the tweet cockpit).

## Persona
"media monkey": a hyper-curious AI monkey that explains one wild fact about
brains, AI, and the internet per reel. Energetic, slightly unhinged, zero
corporate tone. Niche lane: "your brain vs the machine": neuroscience x AI
crossovers (we literally have the fly connectome app as a content mine).

## Pipeline (factory/ directory, node >= 20, zero paid services)
1. topics: Gemini (GEMINI_API_KEY in .env) picks/writes from a topics.json
   backlog + optional HN signals. `node factory/make.mjs --auto` or
   `node factory/make.mjs "topic here"`.
2. script: Gemini -> JSON {hook, beats[], cta, caption, hashtags[]} with
   per-beat spoken text. Persona prompt lives in factory/persona.md.
3. tts: kokoro-js (npm, onnx, runs local). One wav per segment so we get exact
   segment timings; concat via ffmpeg. Word-level karaoke timing approximated
   proportionally within each segment (standard for this genre).
4. background: make.mjs rolls a tier (see the mix above), then:
   - physics: record a FRESH seeded variant for this reel when the projected
     render still fits background.freshBudgetSeconds (240s), else draw from the
     assets/bg pool. Generators are factory/bg/*.html, recorded by
     factory/record-bg.mjs (puppeteer-core + the Chrome for Testing build under
     ~/Library/Caches/ms-playwright, frame-stepped into ffmpeg's image2pipe).
     The pages advance one fixed step per frame, so a 30fps capture takes two
     steps per frame and costs half a 60fps capture for identical output.
   - harvested / publicDomain: draw from assets/clips, filled by
     factory/clips.mjs (see its header for per-source status). Every clip is
     normalized to silent 1080x1920 30fps and has to pass screenClip(): bright
     enough, actually moving, and no burned-in titles.
   `--bg <tier|generator|file>` forces any of it; `--fresh` / `--no-fresh`
   override the budget decision.
5. assemble: ffmpeg: bg loop trimmed to narration length + audio + ASS
   karaoke subtitles burned in + hook title card frame. Output
   out/<date>/<slug>/reel.mp4 + caption.txt (caption + 5 niche hashtags, no
   banned-spam tags).
6. `--batch 3` renders 3 reels from 3 different topics in one run.

## Posting (human in the loop, phase 1)
Factory never posts. The owner posts from the IG app or Meta Business Suite.
Phase 2 (separate): Instagram Graph API scheduled publishing for business
accounts, once the account is converted and a Meta app exists.

## Actions (CI render, phase 2)
The render is already headless and keyless apart from Gemini, so a GitHub
Actions workflow only has to reproduce three local things:

1. FONT. macOS libass finds display faces through coretext; a Linux runner has
   none. `assets/fonts/Anton-Regular.ttf` (SIL OFL 1.1, licence text beside it
   in `OFL.txt`) is committed for exactly this, and `assemble.mjs` prefers
   `assets/fonts` as the libass `fontsdir` whenever it holds a ttf/otf/ttc.
   `config.json -> subtitle.fontName` must keep matching the family name in
   that file ("Anton"), or libass silently substitutes.
2. KOKORO MODEL CACHE. The voice model is downloaded once by
   `@huggingface/transformers` and lives in the directory `tts.mjs` sets as
   `env.cacheDir`:
       ~/.cache/voila/models          (override: MEDIAMONKEY_MODEL_DIR)
       └── onnx-community/Kokoro-82M-v1.0-ONNX/     ~88 MB with the q8 onnx
   Cache that path in Actions (key on `kokoro.modelId` + `kokoro.dtype` from
   config.json), or every run re-downloads ~88 MB before the first word is
   spoken. Nothing else in the pipeline pulls a model.
3. FFMPEG WITH LIBASS. `ffmpeg.mjs` probes candidates for the `subtitles`
   filter and falls back to the `ffmpeg-static` npm build, which ships libass;
   the runner needs no apt step, but it does need `npm ci` to have installed it.

`factory/clips.mjs` is deliberately NOT a CI stage: it drives Chromium and a
local yt-dlp. Clips are harvested on this machine and their mp4s plus
`sources.json` are what the render consumes.

## Acceptance
- `node factory/make.mjs "why your brain cant ignore a loading spinner"`
  produces a watchable reel.mp4 in under 5 minutes on this machine: audible
  energetic voice, readable karaoke captions synced within ~200ms feel, owned
  background, correct 1080x1920, hook frame first.
- No network calls at render time except Gemini for the script.

## Voice

`config.json` -> `voice` takes either a Kokoro voice name (`bm_lewis`) or a
blend (`bm_lewis:0.7,am_michael:0.3`). Weights are normalised, so `7,3` and
`0.7,0.3` mean the same thing.

Kokoro cannot clone: there is no way to hand it a reference clip and get that
speaker back. What it has is a 510x256 style table per voice, and those tables
share a space, so a weighted average of two is a valid third voice. That is the
only free route to a voice that is ours rather than one of the 28 everyone else
ships. `factory/tts.mjs` installs a blend by writing the averaged table over the
`am_santa` slot before that name is first loaded, then generates through the
normal API so kokoro's own text normalisation stays in the path. One blend per
process; `npm ci` restores the original file on CI.

Not possible here, for the record:
- A recognisable character voice. Those are owned, and the persona rules in
  `factory/persona.md` already ban copyrighted characters.
- Cloning a real person. Kokoro has no cloning path; engines that do
  (Chatterbox, F5-TTS, XTTS) are Python and want a GPU, which would end the
  free-CI story this whole pipeline is built on.

`node factory/tts.mjs --sample` renders one wav per entry in `voiceCandidates`
so a change can be listened to before it ships.

## YouTube Shorts

The same reel goes to YouTube on every CI run, before the Instagram step,
because the hosting step wipes the working tree and YouTube needs the bytes
rather than a URL.

A vertical video under three minutes is classified as a Short automatically, so
there is no separate endpoint: `factory/youtube.mjs` does an ordinary resumable
`videos.insert`. Title, tags and description come from the `youtube.json` the
render writes next to `caption.txt`, so nothing has to pick JSON apart in shell.
No secrets set means a polite skip, same as the Instagram publisher.

One-time setup, which needs a browser and a Google account and therefore cannot
be done from CI:

1. In Google Cloud console, create a project and enable the **YouTube Data API
   v3**.
2. OAuth consent screen: external, add yourself as the owner, and set the
   publishing status to **In production**. This matters more than it looks:
   while the screen is in "Testing", Google expires refresh tokens after SEVEN
   DAYS, so CI would quietly start failing a week later. An unverified personal
   app can go to production; the consent screen just shows a warning you click
   past once.
3. Credentials: create an OAuth client of type **Desktop app**. Google accepts
   any `http://127.0.0.1:<port>` redirect for that type, which is what the auth
   helper uses.
4. Run the helper once locally and click through consent:

       YT_CLIENT_ID=... YT_CLIENT_SECRET=... node factory/youtube-auth.mjs

5. Put `YT_CLIENT_ID`, `YT_CLIENT_SECRET` and `YT_REFRESH_TOKEN` in the repo
   secrets next to the Meta ones.

Quota is the one real ceiling: `videos.insert` costs 1600 units against a
default 10,000/day project quota, so **six uploads a day**. The schedule posts
four, which leaves room for one retry. Going beyond that needs a quota increase
request, not a code change.
