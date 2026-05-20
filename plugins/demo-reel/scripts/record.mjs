#!/usr/bin/env node
// record.mjs — Records browser video per scene using Playwright.
// Usage: node record.mjs <scenes.json> --out <outDir> [--scene <id>]

import { readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const scenesPath = resolve(args[0]);
const outDir = resolve(args[args.indexOf('--out') + 1]);
const onlyScene = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null;

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));
const baseUrl = config.baseUrl || 'http://localhost:3000';
const viewport = config.viewport || { width: 1280, height: 720 };
const slowMo = config.slowMo ?? 0;

const clipsDir = join(outDir, 'clips');
mkdirSync(clipsDir, { recursive: true });

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('✗ Playwright not installed. Run: npm install -D playwright && npx playwright install chromium');
  process.exit(1);
}

const { chromium } = playwright;

async function runActions(page, actions) {
  for (const action of actions) {
    switch (action.type) {
      case 'goto': {
        const url = action.url.startsWith('http') ? action.url : `${baseUrl}${action.url}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        break;
      }
      case 'click':
        await page.click(action.selector);
        break;
      case 'fill':
        await page.fill(action.selector, action.text);
        break;
      case 'hover':
        await page.hover(action.selector);
        break;
      case 'wait':
        await page.waitForTimeout(action.ms);
        break;
      case 'waitFor':
        await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10000 });
        break;
      case 'scroll':
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(y => window.scrollBy(0, y), action.y ?? 300);
        }
        break;
      case 'highlight':
        await page.evaluate(sel => {
          const el = document.querySelector(sel);
          if (!el) return;
          const prev = el.style.outline;
          el.style.outline = '3px solid #ff3366';
          el.style.outlineOffset = '4px';
          setTimeout(() => { el.style.outline = prev; }, 1500);
        }, action.selector);
        await page.waitForTimeout(1500);
        break;
      case 'eval':
        await page.evaluate(action.code);
        break;
      default:
        console.warn(`  ⚠ Unknown action type: ${action.type}`);
    }
  }
}

async function recordScene(browser, scene, idx, total) {
  console.log(`  [${idx + 1}/${total}] ${scene.id}`);
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: clipsDir, size: viewport },
  });
  const page = await context.newPage();

  try {
    await runActions(page, scene.actions || []);
  } catch (err) {
    console.error(`    ✗ Action failed in scene "${scene.id}": ${err.message}`);
    await context.close();
    throw err;
  }

  await page.close();
  const video = page.video();
  await context.close();

  // Playwright writes video on context close; rename to predictable name.
  const rawPath = await video.path();
  const targetPath = join(clipsDir, `${scene.id}.webm`);
  if (existsSync(rawPath)) {
    renameSync(rawPath, targetPath);
    console.log(`    ✓ ${targetPath}`);
  } else {
    console.warn(`    ⚠ No video file produced for ${scene.id}`);
  }
}

async function main() {
  const scenes = onlyScene
    ? config.scenes.filter(s => s.id === onlyScene)
    : config.scenes;

  if (scenes.length === 0) {
    console.error(`✗ No scenes to record${onlyScene ? ` (id "${onlyScene}" not found)` : ''}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, slowMo });
  try {
    for (let i = 0; i < scenes.length; i++) {
      await recordScene(browser, scenes[i], i, scenes.length);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(`✗ Recording failed: ${err.message}`);
  process.exit(1);
});
