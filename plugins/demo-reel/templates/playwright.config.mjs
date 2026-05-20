// playwright.config.mjs — Reference config for the demo-reel pipeline.
// The pipeline drives Playwright programmatically (see record.mjs), so this file
// is here for IDE intellisense and for cases where you want to run tests
// independently. It's not required for the pipeline to run.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    viewport: { width: 1280, height: 720 },
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 }
    },
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  workers: 1,
  retries: 0,
});
