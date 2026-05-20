# Quickstart

Get from zero to a recorded demo in about 10 minutes.

## What this is

A Claude Code plugin that turns natural-language requests like *"record a 60-second demo of the dashboard"* into narrated MP4 videos. Playwright drives the browser, Gemini TTS does the voiceover, ffmpeg merges and polishes.

Three skills:

- **record** — single-narrator product demos
- **multi-speaker** — dialogue-driven demos (two or more voices)
- **compose** — add intro/outro cards, lower-thirds, and background music to a finished demo

All three follow a phase-based workflow: Claude interviews you, drafts a storyboard, waits for your approval, runs the pipeline, runs QA, and hands you the file.

## Prereqs

Check these on your machine before installing:

```bash
node --version           # need 18+
ffmpeg -version | head -1
ffprobe -version | head -1
```

If `ffmpeg` is missing: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Debian/Ubuntu).

You'll also need a **Gemini API key** — get one (free tier is plenty for testing) at https://aistudio.google.com/apikey. The plugin will ask for it during install and store it in Claude Code's credential store; for standalone/CLI use, you can also place it in the OS keychain at service `demo-reel`/account `gemini_api_key`, or set `GEMINI_API_KEY` in your shell.

## Install

In any Claude Code session:

```
/plugin marketplace add <repo-url>
/plugin install demo-reel@demo-reel-marketplace
```

Replace `<repo-url>` with the GitHub URL you were given (e.g., `arupmaity/demo-reel-marketplace` or `git@github.com:arupmaity/demo-reel-marketplace.git`).

You'll be prompted for three things:

| Field | What to enter |
|-------|---------------|
| Gemini API key | Paste it (input is masked; goes to OS keychain) |
| Default narrator voice | Press enter for `Kore`, or pick from `Puck`, `Aoede`, `Enceladus`, `Charon`, `Fenrir` |
| Gemini TTS model | Press enter for the default |

Install is one-time per machine — works across every project you open Claude Code in.

## Your first demo

1. **Open Claude Code in the project you want to demo:**

   ```bash
   cd ~/code/your-app
   claude
   ```

2. **Start your dev server** in another terminal (whatever command runs it — `npm run dev`, `pnpm dev`, etc.). Note the URL.

3. **Ask Claude Code in plain English:**

   > Record a 60-second demo of the homepage. Start at the landing page, scroll through the main sections, click into the pricing page, and end at the contact CTA. Confident executive tone.

4. **Answer Claude's discovery questions** — it'll ask about start URL, end state, duration target, audience, key moments, and any setup state (logged-in user, seeded data).

5. **Approve the storyboard.** Claude presents a scene-by-scene plan with narration drafts. Read it, request changes if anything's off, approve when ready. *Recording does not start until you approve.*

6. **Watch it run.** Pipeline streams progress through 4 stages: record → narrate → merge → QA. Takes 1–5 minutes depending on demo length and scene count. First run on a project adds ~2 minutes for Playwright install.

7. **Open the output** at `demo/output/demo.mp4` in your project. Claude tells you the exact path at the end.

## Iterating

If the demo is 90% right but needs tweaks, you don't re-run the whole pipeline. Just tell Claude what to change:

- *"Change the second scene's narration to start with 'Notice how...'"* → Claude runs with `--no-record` (reuses video, regenerates audio only). ~30 seconds.
- *"The third scene's click missed the button — re-do just that scene"* → Claude runs with `--scene <id>`. ~30 seconds for one scene.
- *"Drop the audio entirely, I want video only"* → Claude runs with `--silent`.

This is the iteration loop that makes the plugin actually useful — it's designed so the expensive stages (browser recording, TTS API calls) only run when their inputs actually changed.

## When to use each skill

| Want this | Use this skill | Trigger phrase examples |
|-----------|----------------|-------------------------|
| One narrator walking through features | `record` | "record a demo", "make a walkthrough", "screencast this" |
| Two or more voices in dialogue | `multi-speaker` | "host and guest", "Q&A demo", "Arup explains and Neil asks" |
| Add title card, end card, music, captions | `compose` | "add a title screen", "put music behind it", "brand this video" |

You don't have to remember the names — Claude Code auto-routes based on what you ask for.

## Multi-speaker example

> Make a 90-second host-and-guest walkthrough of the dashboard. I'll be the host explaining features, Neil will be the guest asking sharp questions a CFO would ask. Use Charon for me, Aoede for Neil.

The dialogue ends up in scenes.json like:

```json
{
  "speakers": [
    { "name": "Arup", "voice": "Charon" },
    { "name": "Neil", "voice": "Aoede" }
  ],
  "dialogue": [
    { "speaker": "Arup", "text": "..." },
    { "speaker": "Neil", "text": "..." }
  ]
}
```

Gemini renders both voices in a single API call with natural turn-taking — much better timing than splicing single-voice clips.

## Compose example

After you have a `demo.mp4` you're happy with:

> Add a Xamun-branded title card at the start, an "xamun.com" end card, and a soft ambient music track at 30% volume that ducks under the narration. Music file is at `assets/ambient.mp3`.

Output goes to `demo/output/demo.composed.mp4`. Original is preserved.

## When it's not working

**"Element not found" during recording.** The page hadn't finished rendering when the action fired. Tell Claude: *"add a waitFor before that click."*

**TTS returns `PROHIBITED_CONTENT`.** Gemini's classifier rejected a vague style prompt. Make the narration more concrete or specify a clearer style. Tell Claude: *"the style for scene 2 is too vague — make it more directive."*

**Final video has no audio.** Either `--silent` was passed by mistake, or TTS failed. Check `demo/output/audio/` — if it's empty, the API key may not be reaching the script. Verify with `security find-generic-password -s "demo-reel" -a "gemini_api_key"` on macOS, or check `$GEMINI_API_KEY`. To rotate, run the keychain `add-generic-password ... -U` command or re-run `/plugin install demo-reel`.

**Video shorter than narration.** The pipeline freezes the last frame to pad audio length, but if you want active motion add a slow `scroll` or `hover` at the end. Tell Claude: *"extend scene 3 with a slow scroll so it doesn't freeze."*

**Want to rotate the API key.** Update the keychain entry with `-U` (`security add-generic-password -U -s "demo-reel" -a "gemini_api_key" -w 'NEW_KEY'`), or re-run `/plugin install demo-reel@demo-reel-marketplace` to re-prompt.

## Going deeper

- Full plugin reference: [`plugins/demo-reel/README.md`](./plugins/demo-reel/README.md)
- Scene config schema: [`plugins/demo-reel/templates/scenes.example.json`](./plugins/demo-reel/templates/scenes.example.json)
- Multi-speaker schema: [`plugins/demo-reel/templates/multi-speaker.example.json`](./plugins/demo-reel/templates/multi-speaker.example.json)
- Compose schema: [`plugins/demo-reel/templates/compose.example.json`](./plugins/demo-reel/templates/compose.example.json)

If you hit something not covered here, the per-skill SKILL.md files at `plugins/demo-reel/skills/*/SKILL.md` document the full workflow Claude follows.

## Questions

Ping Arup directly. This plugin lives in a private repo; access and updates flow through him.
