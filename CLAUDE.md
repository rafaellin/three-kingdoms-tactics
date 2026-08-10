# 三国志：战术传说 — 项目协作指南

> 类英雄无敌 3（HOMM3）的六角格回合制策略游戏，Web 平台。
> 需求与设计见 `PRD.md`、`PRD-SUPPLEMENT.md`（权威需求文档）；本文件是协作规范，先读它再读 PRD。

## 项目状态

从零开始（PRD 中所有 checkbox 均未完成）。技术栈已定，尚未搭脚手架。

## 技术栈（2026-08 已确认，勿擅自改动）

| 项 | 选择 |
|---|---|
| 语言 | TypeScript（strict；当前 5.x，兼容前提可用 7.x） |
| 引擎 | **Phaser 4.2**（仅渲染层，禁止在游戏逻辑中使用） |
| 构建 | Vite 8 |
| 测试 | Vitest 4（core 单测）+ Playwright（e2e） |
| 包管理 | **pnpm**（禁止 npm） |
| 分辨率 | 设计基准 1920×1080，默认 RESIZE 自适应，可配置固定分辨率 |

## 架构（最重要，改动前必读）

**核心/渲染分离。** 这是全项目的铁律：

- **`src/core/`** — 纯 TS 游戏逻辑（六角格、寻路、状态、战斗、经济、AI、事件日志）。**零 Phaser / DOM / 浏览器依赖**，不得感知分辨率，不得 import 渲染层任何东西。每个模块可用 Vitest 无浏览器直接测。
- **`src/scenes/`、`src/ui/`、`src/main.ts`** — Phaser 4 渲染层。职责只有两条：
  1. 读取 core 状态并渲染（单向依赖，渲染层可以 import core，core 禁止 import 渲染层）；
  2. 把用户输入转换成 core 动作（调用 core 的 command 接口）。
- **`src/data/`** — 纯数据表（兵种/建筑/武将/技能/地图），不含逻辑。

**确定性（不可破坏）。**

- 每个游戏操作是一个 **command（事件）**，追加进事件日志（`core/events`）。
- **core 内禁止裸 `Math.random()` / `Date.now()`** —— 所有随机必须走注入的 RNG（固定种子），否则回放会失联、回归会时灵时不灵。
- 确定性让 bug 可精确复现、存档/回放/无头 AI 模拟成为可能，这是本项目的调试根基。

**分辨率。** core 只用抽象六角格坐标；像素换算只存在于渲染层 camera/viewport。改分辨率不动 core。

## 代码约定

- 新增 core 逻辑必须配套 Vitest 单测（与源码同目录 `*.test.ts`），断言确定性的输入 → 输出。
- 类型集中 `src/types/`；能定义成纯数据的不要写成逻辑。
- 渲染层保持薄：动画、排版、样式逻辑不进 core。
- 中文注释、中文命名即可（与 PRD 语言一致）；标识符用英文。
- 提交信息清晰描述改动；改动前先跑 `pnpm test`。
- **typecheck 时机**：日常每轮代码修改后**不要**跑 `pnpm typecheck`（费时），仅在 git commit 前检查一次；`pnpm test`（core 单测）每轮改动后照跑。

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 开发服务器 → http://localhost:3000
pnpm test         # core 单元测试（Vitest，无浏览器，快）
pnpm test:e2e     # Playwright 端到端回归（截图 + 状态断言）
pnpm build        # 生产构建
pnpm lint         # 代码检查
```

## 音频（BGM / 音效）

> 音频属渲染层（`src/audio/`）：不进 core / 事件日志 / 确定性回放，选曲/播放用 Math.random 无妨。

**加载（Vite 构建期自动发现）**
- 音频放 `assets/bgm/mp3/`（背景音乐，**游戏只加载这里**）、`assets/sound/`（音效）；`assets/bgm/wav/` 是留给玩家的原声碟（**不加载**）；浏览器可播格式 wav/mp3/ogg/m4a（`.pkf` 等伴生文件自动忽略）。
- 用 `import.meta.glob('/assets/**/*.{wav,mp3,ogg,m4a}', { query: '?url', import: 'default', eager: true })` 自动发现，**新增音频文件无需改代码**；需 `src/vite-env.d.ts`（`/// <reference types="vite/client" />`）提供类型。
- Loader 是 **scene 级**（`scene.load`，Game 实例上没有 `load`）：`scene.load.audio(key, url)` 注册 → `scene.load.start()` 异步加载（不阻塞开局）→ `scene.load.once('complete', …)` 完成回调。

**播放（Phaser 声音系统）**
- `scene.sound` / `game.sound` 是**共享的全局声音管理器**（WebAudio / HTML5Audio / NoAudio 三种实现），场景内 `this.sound` 即全局。
- `sound.add(key, config)` 创建**独立声音实例**（每实例自带 volume/loop 等），`play()` 播放；**多个声音可同时播放（BGM + 音效并发）**，WebAudio 混音。
- `SoundConfig`：`{ volume: 0~1, loop, rate, mute, seek, delay, pan, … }`。
- 全局：`sound.volume`、`sound.mute`、`sound.locked`（浏览器是否锁定音频）、`sound.unlock()`（三种实现均公开可调）。
- **自动播放策略**：WebAudio 需首次用户手势内触发。Phaser 会在首次 input 事件自动解锁；稳妥做法是在首次 pointerdown/keydown 里主动 `sound.unlock()` + 起播。
- **坑**：`BaseSound` 类型上没有 `setVolume`（只有具体实现 WebAudioSound / HTML5AudioSound 有）；运行时 `sound.add()` 返回的实例必为二者之一，用 `src/audio/sound.ts` 的 `setSoundVolume()` 收窄调用。

**约定**
- BGM：`src/audio/BgmManager.ts`，默认音量 10%（`DEFAULT_BGM_VOLUME = 0.1`，宁小勿吵），首次交互后把全部曲目排成 playlist 顺序播放、循环整个 playlist；**主题曲固定第一首**（配置在 `src/data/bgmConfig.json`，`themeSong` = 音频文件名去扩展名，如 `"Neon Jade"`；找不到该曲目则无主题曲、全随机）。洗牌/推进/主题曲优先纯逻辑在 `src/audio/playlist.ts`。
- 移动音效：`src/audio/SfxManager.ts`，`animateMove` 开始时 `playLooped('hero move')`、结束（finally）`stopLooped()`，默认音量 0.3。
- 音量控制走各自 `setVolume`；未来"设置"界面（见 PRD todo）接线；dev bridge 已暴露 `setBgmVolume` / `setSfxVolume` 与 `getState().bgm / .sfx` 供 e2e / 调试。

## 调试 / 回归工作流

> **重要约束：本项目模型（deepseek）不支持多模态，agent 无法"看"图片/截图。**
> 因此：回归验证一律以 **Playwright 状态断言** 为准；截图只作为**给人看的产物**（存 `screenshots/`），由人工目检。**不要**用像素颜色分析等手段去"替代看图"——那是错误方向。

1. **逻辑回归**：`pnpm test` —— 寻路、伤害公式、AI 决策等直接在 core 层断言，不依赖浏览器。
2. **界面回归（以 Playwright 断言为主）**：`pnpm test:e2e` 启动游戏 → 模拟点击/按键 → 通过 dev 调试句柄 `window.__game.getState()`（见 `src/dev/`）断言真实游戏状态。**断言必须写进测试代码**，不靠看截图。
3. **截图给人看**：e2e 顺手存 `screenshots/*.png`，**由用户人工目检**界面观感（每张截图要在测试里注明给谁看、看什么）。agent 可做的"基本验证"包括：读 PNG 文件头 IHDR（字节 16-23 = 宽高）校验分辨率等 meta，但**不分析像素内容**。
4. 出 bug 优先用「固定种子 + 事件日志」在 core 层复现，再修。

## 环境说明

- Windows 11；`Bash` 工具是 Git Bash（POSIX sh），多数场景可用；系统级命令偏好见全局 CLAUDE.md。
- 本项目使用 deepseek 模型：
  - API 可能临时不可用——遇到此类故障**等待后重试当前方案**，不要放弃当前路径（详见全局 CLAUDE.md 规则 5）。
  - **不支持多模态**：agent 无法查看图片/截图。界面验证一律用 Playwright 状态断言；截图产物交给用户目检（见上文"调试 / 回归工作流"）。
