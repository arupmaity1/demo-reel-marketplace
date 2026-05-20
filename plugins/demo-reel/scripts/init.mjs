#!/usr/bin/env node
// init.mjs — Scaffolds a demo/ folder in the current project.
// Copies scenes.example.json → demo/scenes.json and playwright.config template.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '..');
const cwd = process.cwd();
const demoDir = join(cwd, 'demo');

if (existsSync(demoDir)) {
  console.error(`✗ ${demoDir} already exists. Delete it first or work with the existing config.`);
  process.exit(1);
}

mkdirSync(demoDir, { recursive: true });
mkdirSync(join(demoDir, 'output'), { recursive: true });

// Copy scenes template, renaming output path to a sensible default.
const scenesTemplate = JSON.parse(readFileSync(join(pluginRoot, 'templates', 'scenes.example.json'), 'utf8'));
scenesTemplate.output = 'demo/output/demo.mp4';
writeFileSync(join(demoDir, 'scenes.json'), JSON.stringify(scenesTemplate, null, 2));

// Copy playwright config (optional reference — pipeline doesn't strictly require it).
const playwrightConfig = readFileSync(join(pluginRoot, 'templates', 'playwright.config.mjs'), 'utf8');
writeFileSync(join(demoDir, 'playwright.config.mjs'), playwrightConfig);

console.log(`✓ Created demo/ in ${cwd}`);
console.log(`\nNext steps:`);
console.log(`  1. Edit demo/scenes.json — describe what to record + narrate`);
console.log(`  2. Make sure your dev server is running on the baseUrl in scenes.json`);
console.log(`  3. export GEMINI_API_KEY=... (get one at https://aistudio.google.com/apikey)`);
console.log(`  4. Run: node ${join(pluginRoot, 'scripts', 'pipeline.mjs')} demo/scenes.json`);
