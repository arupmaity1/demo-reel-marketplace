---
description: Generate narrated product demo videos from a running web app. Use this skill whenever the user wants to create, record, or produce a demo video, walkthrough, product showcase, feature highlight, screencast, or marketing video of a web application — including phrases like "record a demo", "make a video walkthrough", "screencast this", "generate a product demo", "show this feature in a video", or any request that combines browser automation with narration or voiceover. Also use when the user mentions Playwright + video, or wants TTS-narrated screen recordings. For dialogue or multi-voice demos, see the multi-speaker skill. For adding intro/outro cards or background music, see the compose skill.
---

# Demo Reel — Record

Generate narrated demo videos of web applications using a 6-phase workflow: discover, storyboard, confirm, execute, QA, hand-off.

**Do not skip phases.** Each phase has an explicit gate. Recording a demo without storyboard confirmation, or declaring "done" without running QA, wastes the user's time when the output isn't what they wanted.

## When to use this skill

The user wants a narrated video walkthrough of a web app. Typical phrasing:

- "Record a demo of the dashboard"
- "Make a 60-second walkthrough of the login flow"
- "Generate a product demo showing the new feature"

If the user wants dialogue between multiple voices, defer to the **multi-speaker** skill instead. If they have a recorded demo and want intro/outro cards or background music, defer to the **compose** skill.

## The 6 phases

### Phase 1 — Discover

Interview the user. Ask these questions, in order, in a single turn or two:

1. **Where should the demo start?** (URL, route, or app state)
2. **Where should it end?** (final page, action taken, or state)
3. **Target duration?** (typical: 15s, 30s, 60s, 90s)
4. **Audience?** (executive, technical, end-user, investor)
5. **What 2–4 moments must the demo emphasize?** (the points the user wants to land)
6. **Any setup needed before recording?** (logged-in user, seeded data, specific account)
7. **Tone?** (default: confident executive; alternatives: energetic, instructional, conversational)

If the user gives a sparse brief, suggest reasonable defaults but state them explicitly and ask for confirmation before locking them in. Don't proceed to Phase 2 with ambiguous answers — re-ask the unclear ones.

### Phase 2 — Storyboard

Based on Phase 1, draft a storyboard. Present it as a table. Each scene should be 5–15 seconds. Total duration should match the target ± 10 seconds.

Use this exact format so the user can scan and approve quickly:

```
Storyboard: <demo name>
Total target: <N>s   |   Estimated: <N>s   |   Voice: <voice>   |   Style: <one line>

Scene 1: <id>   [~Xs]
  Purpose:   <what this scene communicates>
  Visual:    <what the browser does — bulleted actions>
  Narration: "<exact text the narrator will say>"

Scene 2: ...
```

Then ask: **"Does this storyboard work, or what should I adjust?"**

**DO NOT** generate scenes.json yet. Wait for explicit approval. If the user requests changes, revise the storyboard and re-present. Keep iterating until they explicitly approve.

### Phase 3 — Generate scenes.json

After approval:

1. Run init if there's no demo folder yet: `node ${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs`
2. Write `demo/scenes.json` from the approved storyboard
3. Show the user the file contents (or a diff if updating an existing one) for a final sanity check
4. Ask if they want any last tweaks before recording

The scenes.json schema (see `templates/scenes.example.json` for a full example):

```json
{
  "output": "demo/output/demo.mp4",
  "baseUrl": "http://localhost:3000",
  "viewport": { "width": 1280, "height": 720 },
  "voice": "Kore",
  "globalStyle": "Confident executive tone.",
  "scenes": [
    { "id": "intro", "narration": "...", "actions": [...] }
  ]
}
```

**Action types** the recorder supports:

| Action | Fields | Description |
|--------|--------|-------------|
| `goto` | `url` | Navigate (absolute or relative to baseUrl) |
| `click` | `selector` | Click an element |
| `fill` | `selector`, `text` | Type into an input |
| `hover` | `selector` | Hover over an element |
| `wait` | `ms` | Wait N milliseconds |
| `waitFor` | `selector`, `timeout?` | Wait for selector to appear |
| `scroll` | `selector?`, `y?` | Scroll to element or by Y pixels |
| `highlight` | `selector` | Briefly outline an element |
| `eval` | `code` | Run arbitrary JS in the page |

**Narration tags** (inline): `[pause]`, `[emphasis]`, `[whispers]`, `[laughs]`.

### Phase 4 — Execute

Before running, verify prereqs:

```bash
node --version          # Need 18+
ffmpeg -version | head -1
ffprobe -version | head -1
```

**API key check.** `narrate.mjs` resolves the Gemini key from (in order): `CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY` env var, `GEMINI_API_KEY` env var, or the OS keychain entry at service `demo-reel`, account `gemini_api_key`.

Quick check:

```bash
[ -n "$CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY" ] \
  || [ -n "$GEMINI_API_KEY" ] \
  || security find-generic-password -s "demo-reel" -a "gemini_api_key" -w >/dev/null 2>&1 \
  && echo "✓ API key available" || echo "✗ MISSING"
```

If missing, recommend the keychain path (persistent, no shell config):

```bash
security add-generic-password -s "demo-reel" -a "gemini_api_key" -w 'YOUR_KEY'
```

If the key was originally set via `/plugin install demo-reel`, re-running `/plugin install` re-prompts. The env var `GEMINI_API_KEY` also works for one-shot/CI runs.

Also confirm their dev server is running at the `baseUrl` in scenes.json — don't try to start it yourself.

If Playwright isn't installed in the project, install it:

```bash
npm install -D playwright
npx playwright install chromium
```

Then run the pipeline:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json
```

The pipeline runs **record → narrate → merge → QA** automatically. Stream the output to the user so they see progress. If a stage fails, surface the exact error and offer specific recovery steps (often: re-record just one scene with `--scene <id>`).

### Phase 5 — QA

The pipeline runs QA as its final stage, so by the time it exits cleanly QA has passed. Read the QA report and present it to the user:

- ✓ items: don't enumerate, just summarize ("clip, audio, and merged output verified for all N scenes")
- ⚠ warnings: list each one with the affected scene
- ✗ errors: shouldn't reach here if pipeline succeeded, but if it does, treat as critical

If QA found warnings (not errors), explain what each one means and whether it's likely to matter:

- *"Black frames detected"*: the page may not have rendered in time. Add a `wait` or `waitFor` before the action.
- *"Audio is very quiet"*: TTS may have produced near-silence. Re-run narrate with a more directive style prompt.
- *"Clip is X% black"*: recording likely failed for that scene. Re-record with `--scene <id>`.
- *"Final video is only Ns for N scenes"*: scenes are too short; the narration may be longer than the video.

Offer to apply fixes interactively. **Do not declare done until the user accepts the warnings or you've fixed them.**

### Phase 6 — Hand-off

Once QA is clean or warnings are accepted, declare done. Present:

```
✓ Demo ready for review

  File:      <absolute path to .mp4>
  Duration:  <N>s
  Scenes:    <N>
  Size:      <X.X> MB
  Audio:     ✓ (or "muted" if --silent)

What to do next:
  • Open the file and review
  • To tweak narration only:  re-run pipeline with --no-record
  • To tweak browser actions: re-run pipeline with --no-narrate
  • To re-do one scene:       use --scene <id>
  • To add intro/outro/music: use the compose skill
```

Then wait for feedback. Don't move on to other tasks until the user confirms the demo is acceptable or asks for revisions.

## Iteration

Once a demo exists, changes are cheap. The output directory persists clips, audio, and merged scenes. Pass flags to skip stages:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json --no-record           # tweak narration only
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json --no-narrate          # tweak browser actions only
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json --scene drill-down    # redo one scene
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json --silent              # video only, no TTS
```

When the user asks for a tweak, identify the minimum stage to re-run and use those flags. Re-running the whole pipeline for a one-word narration change is wasteful.

## Available voices (Gemini TTS)

| Voice | Character |
|-------|-----------|
| `Kore` | Neutral professional (good default) |
| `Puck` | Upbeat, energetic |
| `Aoede` | Clear, articulate, HD quality |
| `Enceladus` | Breathy, contemplative |
| `Charon` | Deep, authoritative |
| `Fenrir` | Warm baritone |

The model is `gemini-3.1-flash-tts-preview` by default. Set `model` at the top of scenes.json to override.

## Reference scripts

- `${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs` — orchestrator (record → narrate → merge → QA)
- `${CLAUDE_PLUGIN_ROOT}/scripts/record.mjs` — Playwright recorder
- `${CLAUDE_PLUGIN_ROOT}/scripts/narrate.mjs` — Gemini TTS client (supports multi-speaker)
- `${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs` — ffmpeg per-scene merge + concat
- `${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs` — quality checks
- `${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs` — scaffolds demo/scenes.json
- `${CLAUDE_PLUGIN_ROOT}/templates/scenes.example.json` — fully-worked example
