import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'src/e2e',
  timeout: 30_000,
  use: {
    // e2e 用独立端口 3100，与开发用 3000 隔离：避免复用到其它目录的旧 dev server
    baseURL: 'http://localhost:3100',
    headless: true,
    // 与设计基准分辨率一致（RESIZE 模式下 canvas = 视口大小）
    viewport: { width: 1920, height: 1080 }
  },
  webServer: {
    command: 'pnpm dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
