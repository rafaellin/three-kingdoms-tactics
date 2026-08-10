import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // core 为纯 TS 逻辑，node 环境即可，无需 DOM
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
