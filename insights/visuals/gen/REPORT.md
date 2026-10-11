# Can Gemini author new machines by itself? Kill test, 2026-10-12

Question: with no fixed list of machines, can the factory's Gemini write a new
Anatomy-style machine per reel (module + fixture), at the odometer's quality,
fast and cheap enough to run per reel?

**How it was tested:** `factory/machines-gen/`.
- One Gemini call gets the condensed Anatomy craft rules, the owner rules, the kit API, `machines.js` and the full `odometer.js`. It returns a mapping, a parts list, a module and a 3 to 4 scene fixture.
- `validate.mjs` runs every frame in a private copy of the scene page, never the live one. It checks page errors, stat fallback, NaN, off-plate geometry, determinism and motion, and holds script time to a 5 ms per frame budget.
- Failures go back to Gemini, up to 3 repair rounds.
- Then the frames are tiled and a motion strip is cut.

**Models:**
- `gemini-3.8-flash`, the factory's model.
- `gemini-3.1-pro-preview`, the strongest on the key (`gemini-pro-latest` resolves to it).

## Results

Scores run 1 to 5 against the odometer, which scores 5 on everything:
- R: reads as a real machine
- E: explains the concept
- L: legible on a phone
- C: premium craft
- M: motion correctness

Cost is an estimate from token counts at assumed list prices.

| Model | Concept | Machine | Repairs | Gen s | Est. $ | R | E | L | C | M | /25 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | integer overflow | odometer (hand built) | n/a | n/a | n/a | 5 | 5 | 5 | 5 | 5 | 25 |
| flash | token bucket | coin hopper | 0 | 174 | 0.08 | 3 | 3 | 2 | 2 | 2 | 12 |
| flash | LRU cache | cartridge magazine | 1 | 216 | 0.13 | 3 | 2 | 1 | 2 | 2 | 10 |
| flash | consistent hashing | annular sorter | 1 | 97 | 0.08 | 3 | 2 | 2 | 2 | 2 | 11 |
| flash | bloom filter | comb gauge | 0 | 183 | 0.09 | 4 | 3 | 3 | 3 | 3 | 16 |
| flash | mutex | mutex gate | 1 | 114 | 0.08 | 3 | 3 | 3 | 2 | 3 | 14 |
| flash | binary search | bisection caliper | 0 | 58 | 0.04 | 4 | 3 | 2 | 3 | 3 | 15 |
| pro | token bucket | coin magazine | 0 | 150 | 0.33 | 2 | 3 | 2 | 1 | 3 | 11 |
| pro | LRU cache | lru chute | 0 | 160 | 0.35 | 2 | 2 | 2 | 2 | 2 | 10 |
| pro | consistent hashing | hash ring | 1 | 363 | 0.80 | 3 | 2 | 2 | 3 | 2 | 12 |
| pro | bloom filter | pin gauge | 2 | 423 | 1.01 | 4 | 3 | 3 | 3 | 3 | 16 |
| pro | mutex | mutex interlock | 3 | 744 | 1.69 | 2 | 1 | 1 | 1 | 2 | 7 |
| pro | binary search | comparator rack | 1 | 350 | 0.77 | 3 | 2 | 2 | 3 | 2 | 12 |
| flash + look | token bucket | token bucket v2 | 0 | +65 | +0.05 | 3 | 3 | 3 | 2 | 3 | 14 (+2) |
| flash + look | LRU cache | cassette magazine v2 | 0 | +91 | +0.05 | 3 | 4 | 3 | 3 | 3 | 16 (+6) |

"flash + look" is one extra round (`refine.mjs`). The model sees its own
frames next to the odometer's and fixes its five worst faults.

| | flash | pro |
|---|---|---|
| validated within 3 repairs | 6 of 6 | 6 of 6 |
| median Gemini time | 135 s | 357 s |
| mean est. cost per machine | $0.08 | $0.83 |
| mean score | 13.0 / 25 | 11.3 / 25 |
| at 4+ on legibility or craft | 0 | 0 |

## What failed

The engineering works. Every machine validated and runs at 0.1 to 1.4 ms of
script per frame (the odometer is 0.6). Every mapping was a real, sensible
object.

The drawing does not reach the bar:
- **Too small to read.** Glyphs, labels and tokens are 5 to 10 px on the phone frame, so the story lives in the readout, not the machine.
- **Painter's order and see-through solids.**
- **Parts floating on nothing.**
- **Half-empty plates.**
- **Story errors the validator cannot see:** two scenes with the same state, and "Target matched" shown over "MID 44, TOO BIG".

The bigger model does not help. Pro is slower, about 10x the cost, and scored lower on average.

Looking helps. One visual critique round gave +2 and +6 for about $0.05 each.

## Verdict

Gemini can author a new machine per reel at production SPEED (flash: 1 to 4
minutes, a few cents), but not at production QUALITY. The best of 14 attempts
scored 16/25 against the odometer's 25. Every failure is in low-level
geometry; none is in the mapping, the timeline or the runtime contract.

## What would fix it, ranked

1. **Hybrid: a kit of pre-made, audited, phone-legible parts.** Base, rails and carriage, drum on axle, cassette or gauge block with a big glyph, token stack, chute and tray, spring, gear, plunger, flag row with ruler, turntable, gate, dial. Gemini writes the mapping, picks and lays out parts on a grid, and writes the timeline. It never draws raw geometry.
2. **Always run the visual critique round.**
3. **More validator checks:** distinct scene end states, label headroom, a minimum glyph size, and see-through solids.
4. **A better prompt:** marginal on its own.
5. **A bigger model:** no.

## Reproduce

    node factory/machines-gen/gen.mjs --concept "bloom filter" --model gemini-3.8-flash
    node factory/machines-gen/run-all.mjs --jobs 6
    node factory/machines-gen/refine.mjs --concept "LRU cache eviction" --model gemini-3.8-flash
    node factory/machines-gen/clip.mjs     # preview videos into insights/visuals/gen/clips/
