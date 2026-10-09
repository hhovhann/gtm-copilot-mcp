# Demo video

A 2 to 3 minute narrated walkthrough: a synthetic voice over simple slides, with real tool output on the demo slides. The final file must stay **under 25 MB**.

| File | What it is |
|---|---|
| `script.md` | The narration, one paragraph per slide, plus what is on screen. Every number spoken is traceable to the code or a recorded run |
| `pronunciations.json` | How the voice says acronyms (for example "dee mark" for DMARC). Subtitles keep the normal spelling |
| `slides.template.html` | The eleven slides (1920 by 1080). Placeholders such as `{{capture:audit.txt:1-7}}` are filled with real output at build time |
| `captures/` | Real tool output shown on the slides (see below) |
| `capture.sh` | Regenerates the deterministic captures from real tool calls against a throwaway database |
| `build.mjs`, `slides.mjs` | The build: `audio` synthesizes and times the narration, `slides` fills the template and renders one PNG per slide |
| `out/` | Generated files (git-ignored): `NN.m4a` narration, `slide-NN.png`, `durations.json` |

## Build

Needs macOS (`say`), `ffmpeg` and `ffprobe`, and Google Chrome.

```bash
./docs/video/capture.sh          # optional: refresh the deterministic captures (needs network for DNS)
node docs/video/build.mjs slides # fill the template, render PNGs, and check that nothing overflows the safe area
node docs/video/build.mjs audio  # synthesize the narration and print the timing per slide
```

Preview one slide's narration with `afplay docs/video/out/05.m4a`. Change the voice or pace with `VIDEO_VOICE` and `VIDEO_RATE` (default `Samantha`, 170 words per minute).

## Where the captures come from

| Capture | Source |
|---|---|
| `audit.txt`, `explain.txt`, `list-leads.txt`, `draft-injection.txt`, `draft-skipped.txt`, `seed.txt` | `capture.sh`: real calls through a real MCP client (`scripts/mcp-call.ts`) against a throwaway database seeded by `scripts/seed-demo-leads.sh` |
| `local-greeting-only.txt`, `local-placeholder.txt`, `local-injection-lead.txt`, `cost.txt` | Recorded on 2026-10-08 from real runs of Llama 3.1 8B and Qwen3 14B through LM Studio, read back with `get_draft` and `estimate_cost_per_meeting`. Model output is not deterministic, so these are kept as recorded rather than regenerated |

The cost slide is parsed from `cost.txt`, so it cannot drift from the tool's real output. The numbers on it are placeholder assumptions, and the slide says so.

## Honesty rules for the video

- Say "synthetic data" and "nothing is sent" up front, and keep the placeholder banner on the cost slide.
- Local-model results describe two small local models. Do not present them as Claude's quality.
- Show only what was actually run. Captures are recorded output, never mock-ups.
