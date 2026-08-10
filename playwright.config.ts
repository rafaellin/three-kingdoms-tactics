import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'src/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    // 与设计基准分辨率一致（RESIZE 模式下 canvas = 视口大小）
    viewport: { width: 1920, height: 1080 }
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000
  }
})
