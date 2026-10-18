# PARALLAX three-minute demonstration

The film explains the customer problem, shows FalkorDB's role, and walks through
an actual browser session: investigate the trial, inspect the counterexample,
approve a meaning, record synthetic task evidence, verify the complete declared
domain, inspect memory, switch tenant, and run the measured verification lab.

The title cards are explanatory graphics. The product screens and results come
from the working application and actual FalkorDB. The visible disclosure is
**Synthetic demo · Real FalkorDB · Guided MCP · Local recording**. Guided mode
uses the official MCP SDK and real tools but makes no language-model request.
The final narration uses Descript's built-in AI voice **Dolores**. No voice was
cloned. This recording does not establish hosted Railway availability or claim
that the synthetic task evidence came from a deployed billing system.

## Files

| File | Purpose |
|---|---|
| `cards.html` | Authored problem, graph-workflow and closing graphics |
| `record.mjs` | Real browser automation and time-stamped frame capture |
| `assemble.py` | Narration retiming, captions, audio normalization and 1080p MP4 assembly |
| `captions.srt` | Final, timed transcript with corrected product and protocol spellings |
| `raw/` | Local capture, chapter evidence and frame checks; excluded from Git |
| `../output/video/` | Rendered film and verification metadata; excluded from Git |

## Record a fresh walkthrough

Use Linux with Node.js 24, the repository dependencies, Python 3 and FFmpeg
(`ffmpeg` and `ffprobe`). The FFmpeg build must include libass. Install Playwright
locally without changing the application's dependency lock:

```bash
npm ci
npm install --no-save --package-lock=false playwright
```

Start the actual local database with `npm run db`. In another terminal, build
and run the production application:

```bash
npm run build
npm run start -- --port 3001
```

Record from a fresh browser context, which receives its own isolated synthetic
workspace:

```bash
PARALLAX_DEMO_URL=http://127.0.0.1:3001 node demo/record.mjs
```

`--rehearse` executes the same interaction sequence without the three-minute
presentation pacing. `--preview-cards` renders only the authored cards.
`PLAYWRIGHT_MODULE` can point to an existing Playwright installation when needed.
The recorder checks graph connectivity and guided mode before capturing. Never
label a model run, disconnected application or fabricated response as the
guided real-graph demonstration.

## Narration and assembly

Export the narration audio and its matching original SRT transcript from the
editable narration composition. Keep those private working files outside Git.
Pass the completed silent recording, audio and original transcript to:

```bash
python3 demo/assemble.py \
  --video /absolute/path/to/the-silent-recording.mp4 \
  --audio /absolute/path/to/narration.m4a \
  --captions /absolute/path/to/narration-original.srt \
  --output output/video/PARALLAX-Demo.mp4
```

The assembler preserves pitch, adds a two-second lead and places the last
spoken cue at 178 seconds. The film ends at **180.000 seconds**. A 90-pixel
caption band below the 1760 × 990 recording prevents captions from hiding
controls. The final canvas is 1920 × 1080 at 25 frames per second with H.264
video and AAC audio. A JSON sidecar records the actual media probe results.

Review decoded frames around investigation, approval, task completion, fresh
verification and tenant switch. Check the matching audio and captions before
submission; a successful encode alone is not evidence of a correct walkthrough.

The public site's current deployment status is recorded in
[`reports/PROGRESS.md`](../reports/PROGRESS.md).
