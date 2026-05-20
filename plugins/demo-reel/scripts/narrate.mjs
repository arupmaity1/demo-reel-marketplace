#!/usr/bin/env node
// narrate.mjs — Generates a WAV file per scene using Gemini TTS.
// Usage: node narrate.mjs <scenes.json> --out <outDir> [--scene <id>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const scenesPath = resolve(args[0]);
const outDir = resolve(args[args.indexOf('--out') + 1]);
const onlyScene = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null;

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));

// API key lookup chain:
// 1. CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY — populated by Claude Code from OS keychain (preferred)
// 2. GEMINI_API_KEY — for CI / standalone script execution
const apiKey = process.env.CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error(`✗ No Gemini API key found.

Looked for:
  1. CLAUDE_PLUGIN_OPTION_GEMINI_API_KEY  (set automatically when the demo-reel plugin is installed via Claude Code)
  2. GEMINI_API_KEY                        (environment variable fallback)

To fix this:
  • If installed via Claude Code: run /plugin disable demo-reel then /plugin enable demo-reel to re-prompt for credentials
  • Outside Claude Code: export GEMINI_API_KEY=your_key_here
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
