# Style reference: rick.theengineer

Frame-by-frame analysis of four reels. This is the target our explainer scene
layer has to reach. Everything below is observed, not guessed.

Reels sampled:
- DdT5wzdsQWV  file upload service      169.7s
- DdVBAnfoWiF  S3 vs R2                 169.9s
- DdSc-I9IqNC  git worktrees            134.5s   2.6K likes
- DdRTy7-M_9K  REST vs GraphQL          159.7s

## 1. The unit is the scene, not the video

Every reel is 30 to 35 numbered scenes at roughly 4 to 5 seconds each. The
scene index is printed on screen ("01 -> 32", "CLOUD STORAGE / 28"). Scenes
hard-cut. There is no camera moving over a fixed board. This is the single
biggest structural difference from what we build today.

Runtime 134s to 170s. He is not afraid of length.

## 2. Page chrome, constant across the whole video

    eyebrow (mono, uppercase, letterspaced)        scene counter, right aligned
    ------------------------------- hairline -----------------------------------
    HEADLINE (bold sans, 1 line, changes every scene)

    subhead (either sentence case grey, or mono uppercase letterspaced)

    [ hero region, scene-type specific ]

    mascot bottom-left            footer series name ("RICK EXPLAINS")
    ---- segmented progress bar ----

- Eyebrow is `CATEGORY / SUBJECT` or `CATEGORY / NN`.
- Headline is a short sentence fragment, often ending in a full stop:
  "Keep going." "Conflicts can still happen." "R2 changes the equation."
  "Let the files flow." "Built for complex stacks."
- Subhead is one plain line: "Same job. Different economics."
- Progress bar fills segment by segment, so the viewer sees how far in they are.

## 3. Cold open is its own layout

First ~2s: no header rule, no counter. Centred huge headline ("REST vs
GraphQL"), small eyebrow top-left ("TWO WAYS TO ASK"), both mascots flanking,
and dashed ghost placeholders in the middle where the real diagram will later
appear. It reads as a title card, then the body layout takes over.

## 4. Scene-type vocabulary

At least nine templates, reused across videos:

1. title card           centred headline, mascots, ghost outlines
2. comparison / VS      two illustrated objects, "VS" between, two-column
                        rule-separated pros underneath
3. architecture flow    icon nodes wired with hairlines, document packets
                        travelling along the wire
4. app window           skeuomorphic replica: traffic lights, real title bar
                        ("auth.ts - Visual Studio Code"), tab row, syntax
                        highlighted code with line numbers, status bar with a
                        branch pill and "UTF-8  TypeScript"
5. artifact card        one object: folder icon, mono path, small coloured pill
                        ("feature/auth"), mono sub-line ("src/ . package.json")
6. diff / conflict card titled card, mono lines with tinted row backgrounds,
                        revealed line by line
7. checklist            logo + title row, then N rows of icon + label, each
                        with a hairline under it, staggered in
8. kinetic type         one huge word or number as the hero ("DATA OUT", "$0")
                        with a mono small-caps label under it
9. dialogue stage       two mascots facing each other, one API/data card
                        between them, dashed CLIENT ---- SERVER topology strip
                        along the top

## 5. Colour

- Ground: warm off-white, roughly #f7f5f2. Some videos add a barely visible
  graph-paper grid, others are flat.
- Ink: near black, roughly #1a1f26.
- One accent hue per video, applied to the caption highlight, pills, wires and
  the kinetic type. Observed: blue for cloud storage, rust for git, green for
  REST vs GraphQL.
- Semantic colours inside scenes: red problem, green ok or win, purple data or
  state, grey inert.
- Everything else is greyscale. The restraint is what makes it look expensive.

## 6. Typography

- Headline: geometric bold sans, roughly 86px at 1080 wide, one line, tight.
- Subhead: two flavours. Grey sentence case for prose, or mono uppercase with
  wide letterspacing for labels.
- Mono is used everywhere real machine text appears: paths, branches, log
  lines, counters, eyebrows. This is a large part of why it reads as
  engineering rather than as a generic explainer.

## 7. Captions

Three to four words at a time in a white rounded box, centred, near the bottom
third. Exactly one word per card is in the accent colour. This is what we
already do, and it matches.

## 8. Mascot

Static, bottom-left, never animated, roughly a quarter of the frame height.
Second character appears only for versus and dialogue formats. The mascot is
set dressing, not a performer.

## 9. Written caption under the post

Hook line, blank line, one-paragraph definition, then "Picture this:" with
arrow bullets, then the mechanism, then the takeaway. Long. Ours is already in
this shape.

## Gap list for our pipeline

Status as of the scene-layer rebuild.

1. DONE  Per-scene headline and hard cuts. `factory/explainer/scenes.mjs`
   builds a scene track; each beat owns two scenes that cut inside it.
   `render.mjs` times the cuts off the real TTS durations.
2. DONE  Scene-type vocabulary. Eight types on a closed menu: flow, compare,
   window, card, list, stat, diff, note. The model picks a type and fills its
   data; the renderer owns every pixel.
3. DONE  App-window chrome. The `window` type draws traffic lights, a title
   bar, numbered lines with tone colours, and a status bar.
4. DONE  Mono for machine text, sans for prose. Inter and JetBrains Mono are
   vendored under assets/fonts and loaded by path, so CI renders the same type
   this machine does. Before this, 'Inter' silently fell back on the runner and
   every burned-in caption was set in Anton, a poster face, which is what made
   them read as titles.
5. DONE  Per-video accent hue keyed off the topic category (`accentFor`).
6. DONE  Header rule, scene counter, segmented progress bar, footer.
7. DONE  Title card cold open, held for exactly the spoken hook.
8. DONE  Kinetic-type scene: the `stat` type.

Not done yet, in rough order of value:

- Real product logos on nodes. Currently generic line icons. Logos are what
  make the reference read as concrete, but they are third-party marks, so this
  needs a deliberate call on which ones to ship.
- A second character for versus and dialogue scenes.
- Document-shaped packets on the wire rather than a square dot.
- Sub-scene reveals inside `window` (typing a line at a time).

Check any layout change with `node factory/explainer/shoot.mjs out/_shots 1,5,10
--zones`, which screenshots the scene page with the Instagram crop zones drawn
on top instead of costing a three minute render.

## Why his reels get the views (2026-10-03, 20 reels, Sep 20 to Oct 3)

Pulled from his public reels grid and post pages. 380K followers, 135 posts.

| views | posted | opening line |
|---|---|---|
| 1.2M | Sep 29 | Your photo takes one second to reach Tokyo. (135s) |
| 1.2M | Sep 25 | Nobody ever wrote the code that lets ChatGPT write Python. |
| 932K | Sep 24 | Load balancer. Cache. Queue. CDN. Replica. Shard. |
| 378K | Sep 22 | ChatGPT writes. Jev decides. (sponsored) |
| 237K | Sep 21 | That enemy who spotted you, ran behind cover... (game AI) |
| 186K | Oct 2 | For 60 years, we threw away the most expensive part of every rocket. |
| 146K | Sep 23 | your app is asking the server "anything new yet?" every second |
| 140K | Oct 1 | Your password is a secret you've already handed to every website. |
| 132K | Sep 26 | Every answer from ChatGPT or Claude is a fight over 80 GB. |
| 130K | Sep 28 | Every app on your phone runs on a database. But not the same one. |
| 125K | Sep 27 | The AI ranked #1 might still be the wrong model for your work. |
| 115K | Sep 20 | ChatGPT answers you in about a second. |
| 75K | Sep 25 | JWT vs sessions isn't old vs modern. |
| 6.7K | Sep 22 | Uploading files is easy. Until a 20 GB video. |
| 5.3K | Sep 27 | Prediction market contract at sixty-three cents. |
| 2.1K | Oct 1 | Minecraft's $2.5 billion empire. |
| 2.0K | Sep 21 | We taught sand how to compute. |
| 472 | Sep 28 | Benchmarks (same topic as the 125K, reposted) |

What separates the hits from the flops, in order of weight:

1. **Audience size of the topic.** Every hit starts from something everyone
   touches: a photo you send, ChatGPT, your password, the apps on your phone,
   an enemy in a game, a rocket. The flops are builder topics (file upload
   service, URL shortener) or off-lane (Minecraft business, prediction
   markets). Our production track ("your p99", epoll, deadlocks) only speaks
   to on-call backend engineers, a pool maybe a hundredth the size.
2. **A person in the first line of the caption.** "Lena taps send on a
   picture of her cat. Before her brother sees it..." A tiny story with a
   named human, then the mechanism.
3. **Character.** The account is an unofficial Rick Sanchez parody: the AI
   cloned cartoon voice and the face are the hook before a word lands. The
   bio links brainrotshorts.com, a paid tool ($29 to $99 a month) that sells
   Rick, Peter Griffin and Homer voices, so the account is partly a showcase
   for it, and it carries sponsored posts. We ruled cloned character voices
   out on IP grounds; the lesson to take is an original character with an
   attitude, not his character.
4. **Length is not the issue.** The 1.2M reel is 135 seconds. Likes run 3 to
   5 percent of views and comments 250 to 320 on the hits.
5. **He tests.** The benchmark topic went out twice a day apart: 125K and
   472. Same idea, different execution, and the loser stays up.
6. **Cadence.** About 1.5 reels a day, not 4.
7. **Numbered captions work for him.** The 1.2M caption walks the seven OSI
   layers as a numbered list. Our ban on numbered steps came from burned-in
   captions reading like titles; it does not obviously hurt a written caption.

Caveat: 380K followers means every reel starts with a big seeded audience.
Absolute views are not comparable to ours at 156 followers; the ranking of
hit and flop topics is.
