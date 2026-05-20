# demo-reel

A Claude Code plugin for generating narrated product demo videos. Three skills, one pipeline.

| Skill | What it does |
|-------|--------------|
| **record** | The main flow. Playwright records the browser, Gemini TTS narrates, ffmpeg merges, QA verifies. Six-phase workflow with explicit confirmation gates. |
| **multi-speaker** | Variant of record where two or more voices speak (Q&A, host-and-guest, dialogue-driven demos). Uses Gemini's multi-speaker TTS. |
| **compose** | Post-processes a finished demo with intro/outro cards, lower-third text overlays, and background music (with optional sidechain ducking under narration). |

Ask Claude Code things like *"record a 60-second demo of the dashboard"*, *"make a dialogue-style walkthrough between two voices"*, or *"add a title card and background music to this demo"* — the right skill triggers automatically.

## Prerequisites

- Node.js 18+
- `ffmpeg` and `ffprobe` in PATH (`brew install ffmpeg` or `apt install ffmpeg`)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- Playwright (auto-installed into target project on first use)

**Credentials.** When you install this plugin via Claude Code (`/plugin install demo-reel@demo-reel-marketplace`), Claude Code prompts for your Gemini API key once and stores it in your OS keychain (macOS Keychain, Windows Credential Manager, or `~/.claude/.credentials.json` as fallback). The plugin's scripts read it from the keychain automatically — no shell config needed.

For standalone use (CI, scripts run outside Claude Code), set the env var instead:

```bash
export GEMINI_API_KEY=your_key_here
```

The scripts check `CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY` first (keychain), then `GEMINI_API_KEY` (env var).

To re-prompt for credentials later (e.g., when rotating the key):

```
/plugin disable demo-reel
/plugin enable demo-reel
```

## Install

### Option A — Local plugin directory (fastest)

```bash
git clone https://github.com/<your-org>/demo-reel-marketplace.git
cd /path/to/your/project
claude --plugin-dir /path/to/demo-reel-marketplace/plugins/demo-reel
```

### Option B — As a marketplace (recommended for reuse)

```
/plugin marketplace add <your-org>/demo-reel-marketplace
/plugin install demo-reel@demo-reel-marketplace
```

### Option C — Local marketplace directory

```
/plugin marketplace add ./demo-reel-marketplace
/plugin install demo-reel@demo-reel-marketplace
```

## Workflow

All three skills follow the same 6-phase pattern:

1. **Discover** — Claude interviews you about start/end, duration, audience, tone
2. **Storyboard** — Claude drafts the demo plan and asks for approval
3. **Generate config** — only after approval, the `.json` config is written
4. **Execute** — pipeline runs (record → narrate → merge for `record`/`multi-speaker`; ffmpeg post-processing for `compose`)
5. **QA** — automated checks for file existence, durations, black frames, audio levels
6. **Hand-off** — declared done only when QA passes; you get a summary and next-step options

No skipping phases. The skill won't start recording until you've approved the storyboard.

## Output layout

```
your-project/
└── demo/
    ├── scenes.json              ← record / multi-speaker config
    ├── compose.json             ← compose config (if used)
    ├── playwright.config.mjs    ← reference
    └── output/
        ├── clips/               ← raw browser video per scene
        ├── audio/               ← Gemini TTS narration per scene
        ├── merged/              ← per-scene video + audio
        ├── demo.mp4             ← record / multi-speaker output
        └── demo.composed.mp4    ← compose output (when used)
```

## Iteration flags (for the `record` and `multi-speaker` pipelines)

| Flag | Use case |
|------|----------|
| `--no-record` | Tweak narration only — reuse existing video clips |
| `--no-narrate` | Tweak browser actions only — reuse existing audio clips |
| `--scene <id>` | Re-do one scene |
| `--silent` | Video only, no TTS or audio |

These are usually invoked by the skill on your behalf when you ask for a tweak.

## Gemini TTS voices

`Kore` (neutral pro), `Puck` (upbeat), `Aoede` (HD articulate), `Enceladus` (breathy), `Charon` (deep authoritative), `Fenrir` (warm baritone). Style direction via `globalStyle` (top-level) or per-scene `style`. Inline tags like `[pause]`, `[emphasis]`, `[whispers]` work mid-line.

## Calling explicitly

If you don't want to wait for auto-triggering:

```
/demo-reel:record
/demo-reel:multi-speaker
/demo-reel:compose
```

## Troubleshooting

**"Element not found"**: Add `waitFor` before the action or increase the preceding `wait`.

**TTS returns `PROHIBITED_CONTENT`**: Make narration more concrete; add a directive preamble in `globalStyle` (the script already prepends "Narrate the following:").

**Final video has no audio**: Check `GEMINI_API_KEY` is set. The QA stage will catch this.

**Video shorter than narration**: Pipeline freezes the last frame to pad to audio length. For active motion instead, add a slow `scroll` or `hover` at the end of the scene.

**Compose: no font found**: The script probes common Linux/macOS font paths. If your system uses a non-standard location, you can edit `findFont()` in `scripts/compose.mjs` to add it.

**Multi-speaker: wrong voice on a line**: Gemini occasionally swaps voices on consecutive lines from the same speaker. Re-run with `--scene <id>`; it usually doesn't recur.

## License

MIT
