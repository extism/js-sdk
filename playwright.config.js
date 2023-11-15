import { defineConfig } from '@playwright/test';

const config = defineConfig({
  webServer: {
    command: 'echo',
    url: 'http://127.0.0.1:8124/dist/tests/browser/',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})

config.testDir = 'tests/';
export default config;
