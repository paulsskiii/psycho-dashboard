import { defineConfig } from "@playwright/test";

// Local only (spec §6.3: visual checks must not spend Actions minutes).
// tests/auth.setup.ts signs in as the owner for the signed-in page tests (see that file).
const STATE = "./.auth/state.json";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  reporter: "list",
  globalSetup: "./tests/auth.setup.ts",
  use: { baseURL: "http://localhost:3000", colorScheme: "dark" },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, storageState: STATE } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 }, storageState: STATE } },
  ],
  webServer: { command: "pnpm dev", url: "http://localhost:3000/signin", reuseExistingServer: true, timeout: 120_000 },
});
