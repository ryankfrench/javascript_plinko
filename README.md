# Study C Plinko task

A Plinko board for a Qualtrics question. The landing bin is drawn before anything moves, then the canvas plays that path. The hosted script does not count toward Qualtrics' 20,000-character limit on question HTML. Only the loader in [qualtrics/round.js](qualtrics/round.js) is stored in the question. That file is about 2,300 characters.

The account must have custom code enabled. Free and trial accounts turn it off.

## What a round does

The participant sees the board and a $10 endowment, then chooses Play or Decline. The ball drops either way. There is no practice drop.

Play shows: "The ball will now drop. Where it lands determines your earnings for this stage."

Decline shows: "The ball will now drop. You chose not to play, so where it lands will NOT affect your earnings of $10 for this stage."

That message stays up for 4 seconds. The drop then takes 10 seconds. The landing stays up for 4 seconds before Next appears. Play pays the bin. Decline pays $10 either way. `signed_outcome` is always the bin amount minus $10.

A refresh or Back after the choice does not draw a new bin and does not replay the drop. The saved landing is shown in place, and the trial is stored with `interrupted: true`.

Use one question per round, on its own page, so other items can sit between rounds. Set `ROUND` to `1` or `2` in that question's script.

## Outcome model

Eight fair left/right steps. The bin is the number of steps to the right (0 through 8), which is the binomial weights 1, 8, 28, 56, 70, 56, 28, 8, 1 out of 256.

| Bins | Payout |
| --- | --- |
| 0 and 8 | $100 |
| 1 and 7 | $50 |
| 2 and 6 | $15 |
| 3 and 5 | $5 |
| 4 | $2.50 |

Expected payout is 2575/256 = $10.0586, so the expected value is about 1.006 times the endowment. Each drop uses a new seed. The log stores the seed and the path, for example `RLRRRLRR`. The choice is not an input to the draw.

The early part of the drop accelerates. The last two segments take half of the drop time and slow down into the bin. The ball meets each peg on the shoulder it is leaving and falls in a shallow arc. That playback is `animation: "guided"`, and it is what Qualtrics uses.

A pilot can switch on Guided Physics with `animation: "guided-physics"`. That drop integrates gravity and peg collisions, then forces each bounce to leave on the predetermined side. The bin and the payout do not change. If a hop cannot reach its peg, that hop plays the guided arc instead and the record sets `physics_fallback` to true. The study loader does not pass this option.

`diskRadius` and `pegRadius` are fractions of the distance from one pin to the next. The defaults are `0.2` and about `0.066`, so the disk's diameter is 40% of that span. A larger disk meets each pin farther out and fills more of the gap, which changes the shape of the bounce. It does not change the drawn bin. The disk still has to fit between pins: keep `2 * diskRadius` below `1 - 2 * pegRadius`. The pilot page has Disk and Pins controls. Both values are stored as `disk_radius` and `peg_radius`.

## Host the script

Upload [plinko.js](plinko.js) to an HTTPS host that serves it as `application/javascript`. A lab server or jsDelivr works. GitHub's raw file URL serves `text/plain`, and the loader will not run it.

Put the same URL in `SCRIPT_URL` in [qualtrics/round.js](qualtrics/round.js). Bump the `?v=1` query when you replace the file so Qualtrics does not keep an old copy.

Third-party libraries are not required. A physics engine would pick the bin itself, which would break this distribution.

## Add it to Qualtrics

Create two text-entry questions, one page each. For each question:

1. Open the HTML view of the question text and paste [qualtrics/round.html](qualtrics/round.html).
2. Open the question JavaScript. Replace the `addOnload` function with [qualtrics/round.js](qualtrics/round.js). Leave `addOnReady` and `addOnUnload` empty.
3. Set `ROUND` to `1` on the first question and `2` on the second.
4. Set `SCRIPT_URL` to the hosted file.
5. In Survey Flow, add these embedded data fields before the block, empty to start. The text-entry answer is the full JSON and is the primary record. The fields below are for display logic and piping.

Round 1: `plinko_r1_decision`, `plinko_r1_bin`, `plinko_r1_payout`, `plinko_r1_earnings`, `plinko_r1_json`

Round 2: `plinko_r2_decision`, `plinko_r2_bin`, `plinko_r2_payout`, `plinko_r2_earnings`, `plinko_r2_json`

On the newer survey-taking experience, also add the same names with an `__js_` prefix, such as `__js_plinko_r1_decision`. `setJSEmbeddedData` writes those names.

The loader hides Next until the reveal dwell ends, hides the text box, and writes the JSON into it again on page submit.

To change timing for a pilot, add any of these to the `Plinko.mount` call in the loader. The participant page has no duration control.

```javascript
dropDurationMs: 8000,
messageDwellMs: 4000,
revealDwellMs: 4000
```

`dropDurationMs` is the ball drop only. 8000, 10000, and 12000 are the durations to compare.

## What is stored

`round`, `decision` (`play` or `decline`), `seed`, `path`, `bin`, `payout`, `endowment`, `earnings`, `signed_outcome`, `interrupted`, `animation` (`guided` or `guided-physics`), `physics_fallback`, `drop_duration_ms`, `message_dwell_ms`, `reveal_dwell_ms`, and these ISO timestamps from the participant's computer clock: `choice_iso`, `message_onset_iso`, `message_offset_iso`, `animation_start_iso`, `animation_end_iso`, `reveal_onset_iso`, `next_enabled_iso`.

`message_offset_iso` and `animation_start_iso` are the same moment: the end of the reading dwell, when the ball starts. The sentence stays on screen until the landing. `payout` is a number, so $2.50 is stored as `2.5`.

Timestamps are the machine clock FaceReader has to be aligned to. This task does not talk to FaceReader.

## Pilot page

Open [index.html](index.html) on a local web server. It runs both rounds, shows the JSON, and can switch the drop among 8, 10, and 12 seconds. The Motion control chooses guided arcs or Guided Physics. Reset clears the saved pilot trials. Add `?fast=1` to shorten the dwells while checking the flow. Do not use this page with participants.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/`.

## Check the distribution

```bash
node test/distribution.js
node test/physics.js
```

The first runs 100,000 draws and checks the binomial counts, the path, the payouts, and the expected value. The second runs every 8-step path through Guided Physics and checks that the pegs and the bin match the path.

## Preview checklist

In Qualtrics preview, on a paid account with custom code on:

- Next is hidden until the landing has been on screen for the reveal dwell.
- Play and Decline show the sentences above, unchanged.
- Decline still records earnings of 10.
- The text-entry answer is the JSON, and its `bin` matches the highlighted bin.
- A refresh after the choice shows the landing without playing the drop again, and `interrupted` is true.
