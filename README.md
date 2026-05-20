# demo-reel-marketplace

A Claude Code plugin marketplace for generating narrated product demo videos with Playwright, Gemini TTS, and ffmpeg.

→ **New here? Start with [QUICKSTART.md](./QUICKSTART.md).** Zero to first demo in about 10 minutes.

## Plugins

- **[demo-reel](./plugins/demo-reel)** — Three skills (record, multi-speaker, compose), six-phase confirmation workflow, native OS-keychain credential storage, automated QA.

## Install

```
/plugin marketplace add <your-org>/demo-reel-marketplace
/plugin install demo-reel@demo-reel-marketplace
```

Replace `<your-org>` with the actual GitHub org/user this repo lives under.

## Docs

- [QUICKSTART.md](./QUICKSTART.md) — 10-minute getting-started
- [plugins/demo-reel/README.md](./plugins/demo-reel/README.md) — full plugin reference
- [plugins/demo-reel/skills/](./plugins/demo-reel/skills/) — per-skill SKILL.md files (record, multi-speaker, compose)
- [plugins/demo-reel/templates/](./plugins/demo-reel/templates/) — example config files for scenes, multi-speaker dialogue, and compose

## Versioning

See [`plugins/demo-reel/.claude-plugin/plugin.json`](./plugins/demo-reel/.claude-plugin/plugin.json) for the current version. The plugin uses explicit semver — users only receive updates when the `version` field is bumped, so push freely without affecting installations until you're ready to ship a new version.

## License

MIT
