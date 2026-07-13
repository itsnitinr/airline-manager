import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
      env: {
        MAP_TEST_HARNESS: "enabled",
        NEXT_PUBLIC_MAP_STYLE_URL: `${baseURL}/__map-style-failure__.json`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `${baseURL}/map/test-harness`,
    };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  ...(webServer === undefined ? {} : { webServer }),
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
      },
    },
  ],
});
