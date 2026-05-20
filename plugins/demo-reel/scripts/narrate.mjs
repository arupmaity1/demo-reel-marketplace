#!/usr/bin/env node
// narrate.mjs — Generates a WAV file per scene using Gemini TTS.
// Usage: node narrate.mjs <scenes.json> --out <outDir> [--scene <id>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const scenesPath = resolve(args[0]);
const outDir = resolve(args[args.indexOf('--out') + 1]);
const onlyScene = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null;

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));

function readFromKeychain() {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('security',
        ['find-generic-password', '-s', 'demo-reel', '-a', 'gemini_api_key', '-w'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      const v = out.toString('utf8').trim();
      return v || null;
    } catch { return null; }
  }
  if (process.platform === 'linux') {
    try {
      const out = execFileSync('secret-tool',
        ['lookup', 'service', 'demo-reel', 'account', 'gemini_api_key'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      const v = out.toString('utf8').trim();
      return v || null;
    } catch { return null; }
  }
  return null;
}

// API key lookup chain:
// 1. CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY — set by Claude Code inside its skill execution context
// 2. GEMINI_API_KEY                       — env var fallback (CI / shell-launched runs)
// 3. OS keychain (macOS: `security`, Linux: `secret-tool`) under service `demo-reel`, account `gemini_api_key`
const apiKey =
  process.env.CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY
  || process.env.GEMINI_API_KEY
  || readFromKeychain();

if (!apiKey) {
  const platformHelp = process.platform === 'darwin'
    ? `  security add-generic-password -s "demo-reel" -a "gemini_api_key" -w 'YOUR_KEY'`
    : process.platform === 'linux'
    ? `  echo -n 'YOUR_KEY' | secret-tool store --label='demo-reel' service demo-reel account gemini_api_key`
    : `  set GEMINI_API_KEY in your environment (Windows keychain not yet supported)`;
  console.error(`✗ No Gemini API key found.

Looked for:
  1. CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY  (Claude Code skill execution context only)
  2. GEMINI_API_KEY                        (environment variable)
  3. OS keychain entry  service="demo-reel"  account="gemini_api_key"

To fix this:
  • Store in OS keychain (recommended):
${platformHelp}
  • Or set the env var: export GEMINI_API_KEY=your_key_here
  • Or reinstall via Claude Code: /plugin disable demo-reel && /plugin install demo-reel@demo-reel-marketplace
  • Get a key at: https://aistudio.google.com/apikey`);
  process.exit(1);
}

// Model and default voice can also come from user config, with scenes.json overriding either
const model = config.model
  || process.env.CLAUDE_PLUGIN_OPTION_DEFAULT_MODEL
  || 'gemini-3.1-flash-tts-preview';
const defaultVoice = config.voice
  || process.env.CLAUDE_PLUGIN_OPTION_DEFAULT_VOICE
  || 'Kore';
const globalStyle = config.globalStyle || '';

const audioDir = join(outDir, 'audio');
mkdirSync(audioDir, { recursive: true });

// Gemini TTS returns raw PCM 16-bit at 24kHz. We wrap it in a WAV header so ffmpeg can read it cleanly.
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // PCM chunk size
  header.writeUInt16LE(1, 20);               // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function buildPrompt(scene) {
  const style = scene.style || globalStyle;

  // Multi-speaker mode: scene has `speakers` array and `dialogue` array.
  if (scene.speakers && scene.dialogue) {
    const lines = scene.dialogue.map(d => `${d.speaker}: ${d.text}`).join('\n');
    const directive = style ? `${style}\n\nGenerate the following multi-speaker dialogue:\n` : 'Generate the following multi-speaker dialogue:\n';
    return directive + lines;
  }

  const narration = scene.narration || '';
  if (!style) return narration;
  return `${style}\n\nNarrate the following:\n${narration}`;
}

function buildSpeechConfig(scene) {
  // Multi-speaker: build speakerVoiceConfigs array
  if (scene.speakers && scene.dialogue) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: scene.speakers.map(s => ({
          speaker: s.name,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
        }))
      }
    };
  }
  // Single-speaker
  const voice = scene.voice || defaultVoice;
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
}

async function generate(scene) {
  const prompt = buildPrompt(scene);
  const speechConfig = buildSpeechConfig(scene);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig
    }
  };

  // Retry up to 3 times — Gemini TTS occasionally returns text tokens instead of audio (~1% rate per docs).
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
      if (!part) throw new Error('No audio data in response (model returned text — retrying)');

      return Buffer.from(part.inlineData.data, 'base64');
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.warn(`    ⚠ Attempt ${attempt} failed: ${err.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

async function main() {
  const scenes = onlyScene
    ? config.scenes.filter(s => s.id === onlyScene)
    : config.scenes;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const isMulti = scene.speakers && scene.dialogue;
    const voiceLabel = isMulti
      ? `multi: ${scene.speakers.map(s => `${s.name}/${s.voice}`).join(', ')}`
      : `voice: ${scene.voice || defaultVoice}`;
    console.log(`  [${i + 1}/${scenes.length}] ${scene.id}  (${voiceLabel})`);

    const hasContent = isMulti
      ? (scene.dialogue && scene.dialogue.length > 0)
      : (scene.narration && scene.narration.trim());

    if (!hasContent) {
      console.log(`    ⊘ No narration/dialogue, skipping`);
      continue;
    }

    const pcm = await generate(scene);
    const wav = pcmToWav(pcm);
    const outPath = join(audioDir, `${scene.id}.wav`);
    writeFileSync(outPath, wav);
    console.log(`    ✓ ${outPath}`);
  }
}

main().catch(err => {
  console.error(`✗ Narration failed: ${err.message}`);
  process.exit(1);
});
