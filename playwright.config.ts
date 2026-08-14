import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'src/e2e',
  timeout: 30_000,
  // 并行 worker 数：默认 max(1, cpu/2)=8 在 16 核上会因资源争抢触发 gotoBooted 超时（pre-existing）；
  // 2 稳定但慢，4 是折中（本机实测 4 全绿）
  workers: 4,
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
