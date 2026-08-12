# Loading 预载 + 全自动 BGM + 战斗页播放控件 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Loading 页预载全部资源 → 主菜单淡入（完成后按钮才可用）→ BGM 全自动（Loading 起播主题曲 / 被锁则 OK 按钮解锁）→ 战斗页获得与冒险页一致的左下角播放控件；`themeSong` 改为统一的 `menu` playlist。

**Architecture:** BGM 从 per-scene 管理器重构为**游戏级共享单例**（`getBgmManager(scene)`），加载归 LoadingScene（Boot）、生命周期归游戏，跨场景持续播放只换 playlist；三个场景分类（menu/explore/battle）走同一套「shuffle → 顺序播放 → 循环 playlist」逻辑，menu 单曲即单曲无缝循环。共享 `BgmControls` 组件（含音量滑块）从 Adventure 内联代码提取，Adventure/Battle 复用。

**Tech Stack:** TypeScript strict、Phaser 4.2.1（仅渲染层）、Vite 8、pnpm、Vitest（core）、Playwright（e2e 状态断言）。

## Global Constraints

- 包管理必须用 `pnpm`，禁止 npm。
- core/渲染分离铁律：所有改动在渲染层（`src/scenes/`、`src/ui/`、`src/audio/`），不触碰 `src/core/` 确定性逻辑；BGM 属纯视听层，不进事件日志/确定性回放。
- 只加载 `assets/bgm/mp3/`（`assets/bgm/wav/` 是原声碟，不加载）。
- 默认 BGM 音量 10%（`DEFAULT_BGM_VOLUME = 0.1`，宁小勿吵）。
- 主题曲 = `bgmConfig.json` 的 `categories.menu` 单曲（当前 `"Neon Jade"`），删除 `themeSong` 字段；`buildPlaylist(tracks, theme, rng)` 保留（有单测），但 BgmManager 不再使用。
- 回归验证以 Playwright 状态断言为准（deepseek 无多模态，不看截图）；截图只给人看。
- 每轮代码改动后跑 `pnpm test`（core 单测）；`pnpm typecheck` 仅在 git commit 前跑一次。
- 提交信息清晰描述改动，用 PowerShell 执行 git（Windows 环境）。

---

### Task 1: LoadingScene 骨架 + MainMenu 淡入 + e2e 导航适配

**Files:**
- Create: `src/scenes/LoadingScene.ts`
- Modify: `src/main.ts`
- Modify: `src/scenes/MainMenuScene.ts`
- Modify: `src/scenes/AdventureScene.ts:1010`（getDebugState 加 `scene` 字段）
- Modify: `src/dev/debug.ts`
- Modify: `src/e2e/helpers.ts`
- Modify: `src/e2e/battle.spec.ts`

**Interfaces:**
- Consumes: 现有 `MainMenuScene.KEY`、`AdventureScene.KEY`、`BattleScene.KEY`。
- Produces: `LoadingScene`（`static KEY = 'Loading'`，`getDebugState(): { ready, scene: 'loading', okButton: {x,y} | null }`）；`MainMenuScene.getDebugState(): { ready, scene: 'menu', menu: { buttonsEnabled } }`；`AdventureScene.getDebugState()` 增加 `scene: 'adventure'`；`helpers` 导出 `gotoBooted(page)`、`gotoAdventure(page)`、`gotoBattle(page)`、`MENU_START`、`MENU_BATTLE`。

本任务只做「加载 → 主菜单」与导航改造，**不含任何 BGM 逻辑**（BgmManager 未动，Audio 由各场景自行加载的旧行为保留，Task 2 再改）。

- [ ] **Step 1: 新建 `src/scenes/LoadingScene.ts`**

```ts
import Phaser from 'phaser'
import { MainMenuScene } from './MainMenuScene'

/** 图标资源（key = 文件名去扩展名，与旧 AdventureScene.preload 一致） */
const ICON_URLS = import.meta.glob('/assets/icons/*.png', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** BGM（只扫 assets/bgm/mp3/；wav/ 原声碟不加载） */
const BGM_URLS = import.meta.glob('/assets/bgm/mp3/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 音效 */
const SFX_URLS = import.meta.glob('/assets/sound/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * 加载页（渲染层）：第一个场景，一次性预载 icon / BGM / SFX 进 Phaser 全局缓存，
 * 之后各场景直接读缓存不再重复解码。加载完成后自动进入主菜单。
 * （Task 2 将在此加入主题曲自动播放 / OK 按钮逻辑。）
 */
export class LoadingScene extends Phaser.Scene {
  static readonly KEY = 'Loading'
  private static readonly BAR_W = 480
  private static readonly BAR_H = 12

  private progressBar!: Phaser.GameObjects.Graphics
  private progressText!: Phaser.GameObjects.Text
  private okButton: Phaser.GameObjects.Text | null = null

  constructor() {
    super(LoadingScene.KEY)
  }

  preload(): void {
    this.cameras.main.setBackgroundColor('#0f1622')
    const { width, height } = this.scale
    this.progressBar = this.add.graphics().setPosition(0, height / 2)
    this.progressText = this.add
      .text(width / 2, height / 2 - 40, '加载中… 0%', {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: '#c8d2e0'
      })
      .setOrigin(0.5)

    for (const [path, url] of Object.entries(ICON_URLS)) {
      this.load.image(LoadingScene.baseKey(path), url)
    }
    for (const [path, url] of Object.entries(BGM_URLS)) {
      this.load.audio(LoadingScene.baseKey(path), url)
    }
    for (const [path, url] of Object.entries(SFX_URLS)) {
      this.load.audio(LoadingScene.baseKey(path), url)
    }

    this.load.on('progress', (v: number) => {
      const { width } = this.scale
      const x = (width - LoadingScene.BAR_W) / 2
      const y = this.progressBar.y - LoadingScene.BAR_H / 2
      this.progressBar.clear()
      this.progressBar.fillStyle(0x1a1f2e, 1)
      this.progressBar.fillRoundedRect(x, y, LoadingScene.BAR_W, LoadingScene.BAR_H, LoadingScene.BAR_H / 2)
      this.progressBar.fillStyle(0x5a7ab0, 1)
      const fillW = Math.max(LoadingScene.BAR_H, v * LoadingScene.BAR_W)
      this.progressBar.fillRoundedRect(x, y, fillW, LoadingScene.BAR_H, LoadingScene.BAR_H / 2)
      this.progressText.setText(`加载中… ${Math.round(v * 100)}%`)
    })
  }

  create(): void {
    // Task 2 将在此加入主题曲自动播放 / OK 按钮逻辑
    this.scene.start(MainMenuScene.KEY)
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'loading',
      okButton: this.okButton ? { x: this.okButton.x, y: this.okButton.y } : null
    }
  }

  /** 路径 → 缓存 key：取文件名（去扩展名），如 '/assets/icons/town.png' → 'town' */
  private static baseKey(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.replace(/\.[^.]+$/, '')
  }
}
```

- [ ] **Step 2: `src/main.ts` 注册 LoadingScene**

把 `import { LoadingScene } from './scenes/LoadingScene'` 加入 import，并把 `scene:` 数组改为：

```ts
scene: [LoadingScene, MainMenuScene, AdventureScene, BattleScene]
```

- [ ] **Step 3: `src/scenes/MainMenuScene.ts` 淡入 + 按钮延迟启用 + getDebugState**

整体重写文件：

```ts
import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'

/**
 * 主菜单（渲染层）：开始游戏 → 大地图；战斗测试 → 战斗场景。
 * 淡入动画完成后按钮才可点（避免动画期间误点）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'
  private buttonsEnabled = false

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const { width, height } = this.scale
    this.cameras.main.setBackgroundColor('#0f1622')
    const title = this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#f5f2e8'
      })
      .setOrigin(0.5)
      .setAlpha(0)
    const startBtn = this.makeButton(width / 2, height * 0.55, '开始游戏')
    const battleBtn = this.makeButton(width / 2, height * 0.68, '战斗测试')
    this.tweens.add({
      targets: [title, startBtn, battleBtn],
      alpha: 1,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.buttonsEnabled = true
        startBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(AdventureScene.KEY))
        battleBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(BattleScene.KEY))
      }
    })
  }

  private makeButton(x: number, y: number, label: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setPadding(24, 12)
      .setOrigin(0.5)
      .setAlpha(0)
  }

  getDebugState(): Record<string, unknown> {
    return { ready: true, scene: 'menu', menu: { buttonsEnabled: this.buttonsEnabled } }
  }
}
```

- [ ] **Step 4: `src/scenes/AdventureScene.ts` getDebugState 加 `scene` 字段**

在 `getDebugState()` 里 `ready: !!state.map,` 那一行之后加一行：

```ts
      scene: 'adventure',
```

- [ ] **Step 5: `src/dev/debug.ts` getActive 扩展到 Loading/MainMenu**

在 import 区加：

```ts
import type { MainMenuScene } from '../scenes/MainMenuScene'
import type { LoadingScene } from '../scenes/LoadingScene'
```

在 `const battle = ...` 之后加：

```ts
  const menu = () => game.scene.getScene('MainMenu') as MainMenuScene | null
  const loading = () => game.scene.getScene('Loading') as LoadingScene | null
```

把 `getActive` 改为：

```ts
  /** 按活动场景返回其 getDebugState；Loading/MainMenu 也有状态（loading 进度、菜单按钮启用） */
  const getActive = (): { getDebugState(): Record<string, unknown> } | null => {
    if (battle()?.scene.isActive()) return battle()
    if (adventure()?.scene.isActive()) return adventure()
    if (menu()?.scene.isActive()) return menu()
    if (loading()?.scene.isActive()) return loading()
    return null
  }
```

- [ ] **Step 6: `src/e2e/helpers.ts` 重写导航（含 OK 按钮处理，前向兼容 Task 2）**

整体重写文件：

```ts
import type { Page } from '@playwright/test'

/** 主菜单按钮中心（1920×1080 设计基准） */
export const MENU_START = { x: 960, y: 594 }
export const MENU_BATTLE = { x: 960, y: 734 }

interface DebugState {
  ready?: boolean
  scene?: string
  okButton?: { x: number; y: number } | null
  menu?: { buttonsEnabled?: boolean }
}

const readState = (page: Page): Promise<DebugState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugState } }).__game?.getState() ?? {})

/** 启动游戏到主菜单就绪：loading →（OK 按钮，如出现）→ 主菜单淡入完成 */
export async function gotoBooted(page: Page): Promise<void> {
  await page.goto('/')
  // 等待 Phaser 起好、canvas 出现
  await page.waitForSelector('canvas', { state: 'attached' })
  // 等 loading 结束：主菜单出现，或 Loading 显示 OK 按钮
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'menu' || (s?.scene === 'loading' && s?.okButton != null)
  })
  const s = await readState(page)
  if (s.scene === 'loading' && s.okButton) {
    // 点击 OK 解锁音频 → 进入主菜单
    await page.mouse.click(s.okButton.x, s.okButton.y)
    await page.waitForFunction(() => {
      const g = (window as { __game?: { getState(): DebugState } }).__game
      return g?.getState()?.scene === 'menu'
    })
  }
  // 主菜单淡入完成、按钮可点
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    return g?.getState()?.menu?.buttonsEnabled === true
  })
}

/** 主菜单 → 大地图并等待就绪 */
export async function gotoAdventure(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'adventure' && s?.ready === true
  })
}

/** 主菜单 → 战斗并等待就绪 */
export async function gotoBattle(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'battle' && s?.ready === true
  })
}
```

- [ ] **Step 7: `src/e2e/battle.spec.ts` 改用 gotoBattle；最后一个用例改等主菜单**

1. import 区加 `import { gotoBattle } from './helpers'`，删除 `const MENU_BATTLE = { x: 960, y: 734 }`。
2. 6 个测试中每个 `await page.goto('/')` + `await page.waitForSelector('canvas', { state: 'attached' })` + `await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)` 三行替换为一行 `await gotoBattle(page)`。
3. 最后一个用例（默认战斗 → 战败 → 返回主菜单）结尾的等待从 `ready === false` 改为 `scene === 'menu'`：

```ts
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.scene === 'menu'
  })
```

- [ ] **Step 8: 跑测试验证**

Run: `pnpm test`
Expected: core 单测全绿（本任务未触碰 core）。

Run: `pnpm test:e2e`
Expected: 全部通过——加载 → 主菜单淡入 → 各场景导航正常；`bgm.spec`（旧语义：adventure 点地图起播）、`sfx.spec`、`camera.spec` 均绿。

- [ ] **Step 9: Commit**

```bash
git add src/scenes/LoadingScene.ts src/main.ts src/scenes/MainMenuScene.ts src/scenes/AdventureScene.ts src/dev/debug.ts src/e2e/helpers.ts src/e2e/battle.spec.ts
git commit -m "feat(loading): LoadingScene 预载资源 + 主菜单淡入（完成后按钮可用）+ e2e 导航适配"
```

---

### Task 2: BgmManager 共享单例 + menu playlist + 主题曲自动播放/OK 解锁 + 场景接线

**Files:**
- Modify: `src/data/bgmConfig.json`
- Modify: `src/audio/BgmManager.ts`（整体重写）
- Modify: `src/scenes/LoadingScene.ts`（create 加主题曲/OK 分支）
- Modify: `src/scenes/MainMenuScene.ts`（create 切 menu 分类；getDebugState 加 bgm）
- Modify: `src/scenes/AdventureScene.ts`（用单例、删 preload、删 load、换监听 API）
- Modify: `src/scenes/BattleScene.ts`（switchToCategory('battle')；getDebugState 加 bgm）
- Modify: `src/audio/SfxManager.ts`（读缓存、load 变 no-op）
- Modify: `src/dev/debug.ts`（setBgmVolume 走单例）
- Modify: `src/e2e/bgm.spec.ts`（重写语义）

**Interfaces:**
- Consumes: `getBgmManager(scene)` 来自 Task 2 本任务产出；`LoadingScene.okButton` 位置来自 Task 1。
- Produces:
  - `export type BgmCategory = 'menu' | 'explore' | 'battle'`
  - `export class BgmManager`：`unlock(): void`、`switchToCategory(cat): void`、`nextTrack()/prevTrack(): void`、`getCurrentTrack(): string | null`、`addTrackListener(cb)/removeTrackListener(cb): void`、`setVolume(v)/getVolume()`、`getState(): BgmState`
  - `export function getBgmManager(scene: Phaser.Scene): BgmManager`
  - `SfxManager.load(): Promise<void>` 变 no-op（其余 API 不变）
  - `LoadingScene.getDebugState()` 增加 `bgm: BgmState`

- [ ] **Step 1: `src/data/bgmConfig.json` — menu playlist，删 themeSong**

整体替换为：

```json
{
  "categories": {
    "menu": ["Neon Jade"],
    "battle": [
      "Silk and Steel",
      "Iron and Silk",
      "Ba Men Jin Suo",
      "A Thousand Miles",
      "Farewell",
      "Chi Bi",
      "Hu Lao Guan",
      "Lone Blade"
    ],
    "explore": [
      "The River",
      "Tao Yuan",
      "Luo Yang"
    ]
  }
}
```

- [ ] **Step 2: `src/audio/BgmManager.ts` 整体重写为共享单例**

```ts
import type Phaser from 'phaser'
import { setSoundVolume } from './sound'
import { buildShuffledPlaylist, nextTrackIndex, prevTrackIndex } from './playlist'
import BGM_CONFIG from '../data/bgmConfig.json'

/**
 * 背景音乐管理器（渲染层，游戏级共享单例）。
 *
 * 职责：
 * - 构建期自动发现 assets/bgm/mp3/ 下全部可播音频（新增文件无需改代码）；
 *   assets/bgm/wav/ 是留给玩家的原声碟，游戏不加载；
 * - 音频由 LoadingScene（Boot）一次性预载进全局缓存，本管理器不再自行加载；
 * - 分类 playlist：menu / explore / battle 统一走「shuffle → 顺序播放 → 循环 playlist」，
 *   menu 单曲 playlist 即单曲无缝循环（loop）；
 * - 解锁（浏览器自动播放策略）：unlock() 安装 document 手势监听，首次手势内 context.resume()；
 * - 默认音量 10%（用户要求：宁小勿吵）。
 *
 * 与 core 的边界：BGM 属纯视听层，不进入事件日志/确定性回放，选曲可用 Math.random。
 * playlist 的洗牌/推进逻辑在 ./playlist（纯函数，可单测）。
 */

/** BGM 播放场景分类 */
export type BgmCategory = 'menu' | 'explore' | 'battle'

/** 默认 BGM 音量（0~1）：10%。 */
export const DEFAULT_BGM_VOLUME = 0.1

/** 只扫 assets/bgm/mp3/（assets/bgm/wav/ 是原声碟，不加载）；.pkf 等伴生文件自动忽略 */
const BGM_URLS = import.meta.glob('/assets/bgm/mp3/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 对外暴露的 BGM 状态（dev bridge / e2e 断言用） */
export interface BgmState {
  /** 音频已加载完成，可起播 */
  ready: boolean
  /** 当前音量（0~1） */
  volume: number
  /** 已开始播放 */
  playing: boolean
  /** 曲目数量（assets/bgm/mp3/ 下可播音频数） */
  trackCount: number
  /** 当前播放顺序（未起播为空数组） */
  playlist: string[]
  /** 当前播放场景分类 */
  currentCategory: BgmCategory | null
  /** 当前播放曲目名 */
  currentTrack: string | null
}

export class BgmManager {
  private readonly keys: string[]
  private current: Phaser.Sound.BaseSound | null = null
  private playlist: string[] = []
  private playlistIndex = -1
  private volume = DEFAULT_BGM_VOLUME
  private ready: boolean
  private playing = false
  private currentCategory: BgmCategory | null = null
  private currentTrack: string | null = null
  private unlocked = false
  private pendingCategory: BgmCategory | null = null
  /** 曲目切换监听（供共享 BgmControls 等 UI 刷新；销毁时注销） */
  private readonly trackListeners = new Set<() => void>()

  constructor(private readonly game: Phaser.Game) {
    this.keys = Object.keys(BGM_URLS).map(BgmManager.baseKey)
    // LoadingScene 预载完成 → 全局缓存全部就绪
    this.ready = this.keys.length === 0 || this.keys.every((k) => this.game.cache.audio.has(k))
  }

  /** 解锁音频（幂等）：安装 document 首次手势监听；解锁后立即执行待定起播 */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.game.sound.unlock()
    if (this.ready && this.pendingCategory) {
      this.startCategory(this.pendingCategory)
    }
  }

  /** 切换到指定场景的 BGM 分类；音频未就绪/未解锁时记录意图，条件满足后自动执行 */
  switchToCategory(category: BgmCategory): void {
    this.pendingCategory = category
    if (this.ready && this.unlocked) {
      this.startCategory(category)
    }
  }

  /** 下一首（单曲 playlist 无操作） */
  nextTrack(): void {
    if (this.playlist.length <= 1) return
    this.playlistIndex = nextTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 上一首（单曲 playlist 无操作） */
  prevTrack(): void {
    if (this.playlist.length <= 1) return
    this.playlistIndex = prevTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 当前曲目名（供 UI 显示） */
  getCurrentTrack(): string | null {
    return this.currentTrack
  }

  /** 注册曲目切换监听（供 UI 控件刷新标签/滑块） */
  addTrackListener(cb: () => void): void {
    this.trackListeners.add(cb)
  }

  /** 注销曲目切换监听（UI 销毁时必须调用，防止泄漏） */
  removeTrackListener(cb: () => void): void {
    this.trackListeners.delete(cb)
  }

  /** 设置音量（0~1，clamp）；未来"设置"界面用 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.current) setSoundVolume(this.current, this.volume)
  }

  getVolume(): number {
    return this.volume
  }

  getState(): BgmState {
    return {
      ready: this.ready,
      volume: this.volume,
      playing: this.playing,
      trackCount: this.keys.length,
      playlist: this.playlist,
      currentCategory: this.currentCategory,
      currentTrack: this.currentTrack
    }
  }

  // ---------- 内部实现 ----------

  private startCategory(category: BgmCategory): void {
    const catTracks: string[] = BGM_CONFIG.categories[category] ?? []
    const available = catTracks.filter((t) => this.keys.includes(t))
    if (available.length === 0) return
    this.stopCurrent()
    this.currentCategory = category
    this.playlist = buildShuffledPlaylist(available, () => Math.random())
    this.playlistIndex = 0
    this.currentTrack = this.playlist[0] ?? null
    this.playing = true
    this.playCurrent()
  }

  /** 播放 playlist 中当前曲目；单曲 loop（无缝），多曲播完自动推进下一首 */
  private playCurrent(): void {
    if (this.playlist.length === 0) return
    this.stopCurrent()
    const key = this.playlist[this.playlistIndex] ?? (this.keys[0] as string)
    this.currentTrack = key
    this.emitTrackChange()
    const isSingle = this.playlist.length === 1
    const s = this.game.sound.add(key, { volume: this.volume, loop: isSingle })
    if (!isSingle) {
      s.once('complete', () => this.nextTrack())
    }
    s.play()
    this.current = s
  }

  private emitTrackChange(): void {
    for (const cb of this.trackListeners) cb()
  }

  private stopCurrent(): void {
    if (this.current) {
      this.current.stop()
      this.current.destroy()
      this.current = null
    }
  }

  /** 路径 → 缓存 key：取文件名（去扩展名），如 '/assets/bgm/mp3/Neon Jade.mp3' → 'Neon Jade' */
  private static baseKey(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.replace(/\.[^.]+$/, '')
  }
}

let instance: BgmManager | null = null

/** 获取游戏级共享 BGM 管理器（首次调用时创建，之后复用） */
export function getBgmManager(scene: Phaser.Scene): BgmManager {
  if (!instance) instance = new BgmManager(scene.game)
  return instance
}
```

- [ ] **Step 3: `src/scenes/LoadingScene.ts` — create 加主题曲自动播放 / OK 分支**

1. import 加 `import { getBgmManager } from '../audio/BgmManager'`。
2. `create()` 整体替换为：

```ts
  create(): void {
    const bgm = getBgmManager(this)
    if (this.sound.unlocked) {
      // 已有用户手势 → 音频可直接播：直接起播主题曲并进入主菜单
      bgm.unlock()
      bgm.switchToCategory('menu')
      this.scene.start(MainMenuScene.KEY)
    } else {
      // 音频被浏览器自动播放策略锁定：装解锁监听 + 显示 OK 按钮，单击解锁并起播主题曲
      bgm.unlock()
      this.showOkButton(bgm)
    }
  }

  private showOkButton(bgm: BgmManager): void {
    const { width, height } = this.scale
    this.okButton = this.add
      .text(width / 2, height * 0.6, '点击进入', {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setOrigin(0.5)
      .setPadding(24, 12)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
    this.okButton.on('pointerdown', () => {
      bgm.switchToCategory('menu')
      this.scene.start(MainMenuScene.KEY)
    })
  }
```

3. `getDebugState()` 改为：

```ts
  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'loading',
      okButton: this.okButton ? { x: this.okButton.x, y: this.okButton.y } : null,
      bgm: getBgmManager(this).getState()
    }
  }
```

（`private okButton: Phaser.GameObjects.Text | null = null` 字段已在 Task 1 声明。）

- [ ] **Step 4: `src/scenes/MainMenuScene.ts` — create 切 menu 分类 + getDebugState 加 bgm**

1. import 加 `import { getBgmManager } from '../audio/BgmManager'`。
2. `create()` 开头（`const { width, height } = this.scale` 之前）加：

```ts
    const bgm = getBgmManager(this)
    if (bgm.getState().currentCategory !== 'menu') {
      bgm.switchToCategory('menu')
    }
```

3. `getDebugState()` 改为：

```ts
  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'menu',
      menu: { buttonsEnabled: this.buttonsEnabled },
      bgm: getBgmManager(this).getState()
    }
  }
```

- [ ] **Step 5: `src/scenes/AdventureScene.ts` — 单例接线 + 删 preload + 删 load**

1. import 行 18 `import { BgmManager } from '../audio/BgmManager'` 改为 `import { BgmManager, getBgmManager } from '../audio/BgmManager'`。
2. 删除 `preload()` 方法（含 `ICON_URLS` 遍历；该方法内没有其它逻辑）。
3. 删除文件顶部 `ICON_URLS` 常量定义（约 72 行处）。
4. 字段区（`this.bgm` 附近）加：

```ts
  private readonly trackChangeHandler = (): void => this.refreshBgmLabel()
```

5. `create()` 里四处改动：

```ts
    this.bgm = getBgmManager(this)                 // 原：new BgmManager(this)
    ...
    this.bgm.addTrackListener(this.trackChangeHandler)  // 原：setTrackChangeCallback(() => this.refreshBgmLabel())
    ...
    this.bgm.switchToCategory('explore')           // 原：void this.bgm.load().then(() => this.bgm?.switchToCategory('explore'))
    this.sfx = new SfxManager(this)                // 删除下一行：void this.sfx.load()
```

6. 在 `create()` 末尾（`this.scale.on('resize', ...)` 附近）加场景 shutdown 时注销监听：

```ts
    this.events.once('shutdown', () => this.bgm?.removeTrackListener(this.trackChangeHandler))
```

- [ ] **Step 6: `src/audio/SfxManager.ts` — 读缓存、load 变 no-op**

把构造函数改为（其余方法不变）：

```ts
  constructor(private readonly scene: Phaser.Scene) {
    for (const [path, url] of Object.entries(SFX_URLS)) {
      const key = SfxManager.baseKey(path)
      this.keys.add(key)
    }
    // 音频由 LoadingScene 预载进全局缓存 → 构造即可用（无需再加载）
    this.ready = this.keys.size === 0 || Array.from(this.keys).every((k) => this.scene.game.cache.audio.has(k))
    // 场景关闭时停止循环音效
    this.scene.events.once('shutdown', () => this.stopLooped())
  }

  /** 兼容旧调用：音频已由 LoadingScene 预载，无需再加载 */
  load(): Promise<void> {
    return Promise.resolve()
  }
```

- [ ] **Step 7: `src/scenes/BattleScene.ts` — battle 分类 + getDebugState 加 bgm**

1. import 加 `import { getBgmManager } from '../audio/BgmManager'`。
2. `create()` 里（`this.moveWaiter = null` 之后、`this.createLayers()` 之前）加：

```ts
    getBgmManager(this).switchToCategory('battle')
```

3. `getDebugState()` 返回对象里加（在 `scene: 'battle',` 之后）：

```ts
      bgm: getBgmManager(this).getState(),
```

- [ ] **Step 8: `src/dev/debug.ts` — setBgmVolume 走共享单例**

1. import 加 `import { getBgmManager } from '../audio/BgmManager'`。
2. `setBgmVolume` 实现改为：

```ts
    setBgmVolume(volume) {
      getBgmManager(game).setVolume(volume)
    },
```

- [ ] **Step 9: `src/e2e/bgm.spec.ts` 重写为自动播放语义**

整体重写文件：

```ts
import { expect, test } from '@playwright/test'
import { gotoAdventure, gotoBooted, gotoBattle } from './helpers'
import { readdirSync, readFileSync } from 'node:fs'

/** 期望曲目数：只统计 assets/bgm/mp3/ 下的音频（assets/bgm/wav/ 是原声碟，游戏不加载） */
const EXPECTED_TRACKS = readdirSync('assets/bgm/mp3').filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f)).length

/** BGM 配置（跟随 src/data/bgmConfig.json） */
interface BgmConfig {
  categories: { menu: string[]; battle: string[]; explore: string[] }
}
const BGM_CONFIG = JSON.parse(readFileSync('src/data/bgmConfig.json', 'utf8')) as BgmConfig

const EXPLORATION_TRACKS = BGM_CONFIG.categories.explore
const MENU_TRACK = BGM_CONFIG.categories.menu[0] as string

interface BgmState {
  ready?: boolean
  volume?: number
  playing?: boolean
  trackCount?: number
  playlist?: string[]
  currentCategory?: string | null
  currentTrack?: string | null
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  bgm?: BgmState
}

const getBgm = (page: import('@playwright/test').Page): Promise<BgmState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState()?.bgm ?? {}
  })

const waitBgmPlaying = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.bgm?.playing === true)

const setBgmVolume = (page: import('@playwright/test').Page, v: number) =>
  page.evaluate((vol) => (window as { __game?: { setBgmVolume(v: number): void } }).__game?.setBgmVolume(vol), v)

test('BGM：主菜单自动播放主题曲（menu playlist 单曲）', async ({ page }) => {
  await gotoBooted(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.trackCount).toBe(EXPECTED_TRACKS)
  expect(bgm.currentCategory).toBe('menu')
  expect(bgm.currentTrack).toBe(MENU_TRACK)
  expect(bgm.playlist).toEqual([MENU_TRACK])
  expect(bgm.volume).toBeCloseTo(0.1)
})

test('BGM：开始游戏 → 探索 playlist 自动播放（无需点击）→ setBgmVolume 生效', async ({ page }) => {
  await gotoAdventure(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.currentCategory).toBe('explore')
  expect(bgm.playlist?.length).toBe(EXPLORATION_TRACKS.length)
  for (const t of EXPLORATION_TRACKS) {
    expect(bgm.playlist).toContain(t)
  }
  expect(bgm.currentTrack).toBeTruthy()
  expect(EXPLORATION_TRACKS).toContain(bgm.currentTrack!)
  await setBgmVolume(page, 0.5)
  expect((await getBgm(page)).volume).toBeCloseTo(0.5)
  await setBgmVolume(page, 0)
  expect((await getBgm(page)).volume).toBe(0)
})

test('BGM：战斗测试 → battle 分类自动播放', async ({ page }) => {
  await gotoBattle(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.currentCategory).toBe('battle')
  expect(bgm.playlist?.length).toBe(BGM_CONFIG.categories.battle.length)
})
```

- [ ] **Step 10: 跑测试验证**

Run: `pnpm test`
Expected: core 单测全绿（playlist.test.ts 不变）。

Run: `pnpm test:e2e`
Expected: 全部通过——主题曲在 menu 自动播放；explore/battle 分类自动播放；sfx/camera/battle 回归仍绿。

- [ ] **Step 11: Commit**

```bash
git add src/data/bgmConfig.json src/audio/BgmManager.ts src/scenes/LoadingScene.ts src/scenes/MainMenuScene.ts src/scenes/AdventureScene.ts src/scenes/BattleScene.ts src/audio/SfxManager.ts src/dev/debug.ts src/e2e/bgm.spec.ts
git commit -m "feat(audio): BgmManager 共享单例 + menu playlist + 主题曲自动播放/OK 解锁 + 场景接线"
```

---

### Task 3: 共享 BgmControls 组件（含音量）+ 冒险/战斗接入 + 战斗控件 e2e

**Files:**
- Modify: `src/ui/BgmControls.ts`（整体重写）
- Modify: `src/scenes/AdventureScene.ts`（删内联控件，用组件）
- Modify: `src/scenes/BattleScene.ts`（加组件 + getDebugState 暴露控件状态）
- Modify: `src/e2e/bgm.spec.ts`（battle 用例加控件交互断言）

**Interfaces:**
- Consumes: `BgmManager`（Task 2 产出的 `prevTrack/nextTrack/getCurrentTrack/getVolume/setVolume/getState/addTrackListener/removeTrackListener`）、`getBgmManager(scene)`。
- Produces:
  - `export class BgmControls`：`constructor(scene, bgm, hooks?: { onCreateObject? })`；`destroy(): void`；`getDebugState(): Record<string, unknown>`（含 `present/prev/next/volume/slider/sliderVisible` 位置）
  - `AdventureScene.getDebugState()` 增加 `bgmControls`
  - `BattleScene.getDebugState()` 增加 `bgmControls`

- [ ] **Step 1: `src/ui/BgmControls.ts` 整体重写**

```ts
import type Phaser from 'phaser'
import type { BgmManager } from '../audio/BgmManager'

/** 创建控件时对每个 Phaser 对象执行的回调（Adventure 传 uiOnly 归入 UI 相机；Battle 不传） */
export interface BgmControlsHooks {
  onCreateObject?: <T extends Phaser.GameObjects.GameObject>(obj: T) => T
}

/**
 * BGM 播放控件（渲染层共享组件）：上一首 / 曲名 / 下一首 / 音量按钮 + 音量滑块。
 * 左下角固定，scrollFactor(0) 不随相机缩放。
 * destroy() 注销 BGM 曲目监听与 resize 监听（Phaser 对象随场景 shutdown 自动销毁）。
 */
export class BgmControls {
  private static readonly SLIDER_W = 120
  private static readonly SLIDER_H = 8

  private readonly prevBtn: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly nextBtn: Phaser.GameObjects.Text
  private readonly volumeBtn: Phaser.GameObjects.Text
  private readonly slider: Phaser.GameObjects.Graphics
  private sliderVisible = false
  private sliderDragging = false
  private readonly onTrackChanged = (): void => this.refresh()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bgm: BgmManager,
    hooks?: BgmControlsHooks
  ) {
    const wrap = <T extends Phaser.GameObjects.GameObject>(obj: T): T =>
      hooks?.onCreateObject ? hooks.onCreateObject(obj) : obj
    const y = scene.cameras.main.height - 56
    const btnStyle = { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' }
    const labelStyle = { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#1a1f2e' }

    this.prevBtn = wrap(scene.add.text(16, y, '<', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.label = wrap(scene.add.text(this.prevBtn.x + this.prevBtn.width + 6, y, '', labelStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8))
    this.nextBtn = wrap(scene.add.text(this.label.x + this.label.width + 6, y, '>', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.volumeBtn = wrap(scene.add.text(this.nextBtn.x + this.nextBtn.width + 6, y, '\u{1F50A}', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.slider = wrap(scene.add.graphics().setPosition(0, y + 12).setDepth(13).setScrollFactor(0).setVisible(false))

    this.prevBtn.on('pointerdown', () => { this.bgm.prevTrack(); this.refresh() })
    this.nextBtn.on('pointerdown', () => { this.bgm.nextTrack(); this.refresh() })
    this.volumeBtn.on('pointerdown', () => this.toggleSlider())

    this.bgm.addTrackListener(this.onTrackChanged)
    this.scene.scale.on('resize', this.onResize)
    this.refresh()
  }

  /** 注销监听（场景 shutdown 时调用）；Phaser 对象由场景销毁 */
  destroy(): void {
    this.bgm.removeTrackListener(this.onTrackChanged)
    this.scene.scale.off('resize', this.onResize)
  }

  private readonly onResize = (): void => {
    const y = this.scene.cameras.main.height - 56
    this.prevBtn.setY(y)
    this.label.setY(y)
    this.nextBtn.setY(y)
    this.volumeBtn.setY(y)
    this.slider.setPosition(this.volumeBtn.x + this.volumeBtn.width + 8, y + 12)
    if (this.sliderVisible) this.drawSlider()
  }

  /** 刷新曲名 / 音量图标 / 滑块位置（切歌、播放状态、音量变化时调用） */
  refresh(): void {
    const track = this.bgm.getCurrentTrack()
    const playing = this.bgm.getState().playing
    this.label.setText(track && playing ? `\u{266A} ${track}` : '')
    this.label.setX(this.prevBtn.x + this.prevBtn.width + 6)
    this.nextBtn.setX(this.label.x + this.label.width + 6)
    this.volumeBtn.setX(this.nextBtn.x + this.nextBtn.width + 6)
    const v = this.bgm.getVolume()
    if (v <= 0) this.volumeBtn.setText('\u{1F507}')       // 🔇
    else if (v <= 0.33) this.volumeBtn.setText('\u{1F508}') // 🔈
    else if (v <= 0.66) this.volumeBtn.setText('\u{1F509}') // 🔉
    else this.volumeBtn.setText('\u{1F50A}')                // 🔊
    this.slider.setPosition(this.volumeBtn.x + this.volumeBtn.width + 8, this.volumeBtn.y + 12)
    this.drawSlider()
  }

  private toggleSlider(): void {
    this.sliderVisible = !this.sliderVisible
    if (this.sliderVisible) {
      this.slider.setVisible(true)
      const hitArea = new Phaser.Geom.Rectangle(0, -8, BgmControls.SLIDER_W, BgmControls.SLIDER_H + 16)
      this.slider.setInteractive({ hitArea, hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true })
      this.slider.on('pointerdown', this.sliderDownHandler)
      this.scene.input.on('pointermove', this.sliderMoveHandler)
      this.scene.input.on('pointerup', this.sliderUpHandler)
      this.scene.input.on('pointerupoutside', this.sliderUpHandler)
      this.drawSlider()
    } else {
      this.hideSlider()
    }
  }

  private hideSlider(): void {
    this.slider.setVisible(false)
    this.sliderDragging = false
    this.slider.removeInteractive()
    this.slider.off('pointerdown', this.sliderDownHandler)
    this.scene.input.off('pointermove', this.sliderMoveHandler)
    this.scene.input.off('pointerup', this.sliderUpHandler)
    this.scene.input.off('pointerupoutside', this.sliderUpHandler)
  }

  private readonly sliderDownHandler = (pointer: Phaser.Input.Pointer): void => {
    this.sliderDragging = true
    this.updateSliderFromPointer(pointer)
  }

  private readonly sliderUpHandler = (): void => { this.sliderDragging = false }

  private readonly sliderMoveHandler = (pointer: Phaser.Input.Pointer): void => {
    if (!this.sliderVisible || !this.sliderDragging) return
    this.updateSliderFromPointer(pointer)
  }

  /** 由指针计算滑块本地位置 → clamp → setVolume → 刷新（scrollFactor(0) 对象 .x 即屏幕坐标） */
  private updateSliderFromPointer(pointer: Phaser.Input.Pointer): void {
    const localX = pointer.x - this.slider.x
    const vol = Phaser.Math.Clamp(localX / BgmControls.SLIDER_W, 0, 1)
    this.bgm.setVolume(vol)
    this.refresh()
  }

  /** 重绘滑块：轨道背景 + 已选填充 + 手柄圆点 */
  private drawSlider(): void {
    const vol = this.bgm.getVolume()
    const W = BgmControls.SLIDER_W
    const H = BgmControls.SLIDER_H
    const fillW = Math.max(H, vol * W)
    const g = this.slider
    g.clear()
    g.fillStyle(0x1a1f2e, 1)
    g.fillRoundedRect(0, 0, W, H, H / 2)
    g.fillStyle(0x5a7ab0, 1)
    g.fillRoundedRect(0, 0, fillW, H, H / 2)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(fillW, H / 2, 7)
    g.lineStyle(1.5, 0x5a7ab0, 1)
    g.strokeCircle(fillW, H / 2, 7)
  }

  /** 供 dev bridge / e2e 断言控件存在与位置 */
  getDebugState(): Record<string, unknown> {
    return {
      present: true,
      prev: { x: this.prevBtn.x, y: this.prevBtn.y },
      next: { x: this.nextBtn.x, y: this.nextBtn.y },
      volume: { x: this.volumeBtn.x, y: this.volumeBtn.y },
      slider: { x: this.slider.x, y: this.slider.y },
      sliderVisible: this.sliderVisible
    }
  }
}
```

- [ ] **Step 2: `src/scenes/AdventureScene.ts` — 删内联控件，接入组件**

1. import 加 `import { BgmControls } from '../ui/BgmControls'`。
2. 删除字段：`bgmPrevBtn`、`bgmLabel`、`bgmNextBtn`、`bgmVolumeBtn`、`bgmSlider`、`bgmSliderVisible`、`bgmSliderDragging`、`SLIDER_W`、`SLIDER_H`（约 130-146 行）。
3. 删除方法：`refreshBgmLabel`、`updateVolumeIcon`、`toggleBgmSlider`、`showBgmSlider`、`hideBgmSlider`、`bgmSliderDownHandler`、`bgmSliderUpHandler`、`bgmSliderMoveHandler`、`updateSliderFromPointer`、`drawBgmSlider`（约 288-397 行整块）。
4. 删除 `create()` 里的 `this.bgm.addTrackListener(this.trackChangeHandler)` 与其对应 shutdown 注销（Task 2 加的两处）；删除 `trackChangeHandler` 字段。
5. 字段区加：

```ts
  private bgmControls: BgmControls | null = null
```

6. `createLayers()` 末尾（原 BGM 控件内联块，约 536-554 行）整体替换为：

```ts
    // BGM 播放控件（左下角）：共享组件，对象归入 UI 相机（不随大地图缩放）
    this.bgmControls = new BgmControls(this, this.bgm, { onCreateObject: (obj) => this.uiOnly(obj) })
```

7. `create()` 里（`this.scale.on('resize', () => this.repositionBottomControls())` 之后）加：

```ts
    this.events.once('shutdown', () => this.bgmControls?.destroy())
```

8. `repositionBottomControls()` 改为只处理结束回合按钮：

```ts
  /** 窗口 resize 时重新排布结束回合按钮（BGM 控件由 BgmControls 自行处理） */
  private repositionBottomControls(): void {
    const cam = this.cameras.main
    const y = cam.height - 56
    this.endTurnButton.setPosition(cam.width - 140, y)
  }
```

9. `getDebugState()` 返回对象里加（在 `bgm:` 之后）：

```ts
      bgmControls: this.bgmControls?.getDebugState() ?? null,
```

- [ ] **Step 3: `src/scenes/BattleScene.ts` — 接入组件 + getDebugState 暴露控件**

1. import 加 `import { BgmControls } from '../ui/BgmControls'`（`getBgmManager` 已在 Task 2 引入）。
2. 字段区加：

```ts
  private bgmControls: BgmControls | null = null
```

3. `create()` 里（`this.setupBattle()` 之后）加：

```ts
    this.bgmControls = new BgmControls(this, getBgmManager(this))
    this.events.once('shutdown', () => this.bgmControls?.destroy())
```

4. `getDebugState()` 返回对象里加（在 `bgm:` 之后）：

```ts
      bgmControls: this.bgmControls?.getDebugState() ?? null,
```

- [ ] **Step 4: `src/e2e/bgm.spec.ts` — battle 用例加控件交互断言**

把 `test('BGM：战斗测试 → battle 分类自动播放', ...)` 用例整体替换为：

```ts
test('BGM：战斗测试 → battle 分类 + 左下角控件交互（音量滑块/上一首）', async ({ page }) => {
  await gotoBattle(page)
  await waitBgmPlaying(page)
  const getControls = () =>
    page.evaluate(() => {
      const g = (window as { __game?: { getState(): DebugGameState & { bgmControls?: { present?: boolean; prev?: { x: number; y: number }; next?: { x: number; y: number }; volume?: { x: number; y: number }; slider?: { x: number; y: number }; sliderVisible?: boolean } } } }).__game
      return g?.getState()?.bgmControls ?? {}
    })
  const c = await getControls()
  expect(c.present).toBe(true)
  expect((await getBgm(page)).currentCategory).toBe('battle')

  // 点音量按钮 → 滑块出现 → 点滑块中部 → 音量约 50%
  await page.mouse.click(c.volume!.x, c.volume!.y)
  await page.waitForTimeout(50)
  expect((await getControls()).sliderVisible).toBe(true)
  await page.mouse.click(c.slider!.x + 60, c.slider!.y)
  await page.waitForTimeout(50)
  const vol = (await getBgm(page)).volume as number
  expect(vol).toBeGreaterThan(0.3)
  expect(vol).toBeLessThan(0.7)

  // 点上一首 → 仍为 battle 分类（playlist ≥ 2 时切换曲目）
  await page.mouse.click((await getControls()).prev!.x, (await getControls()).prev!.y)
  await page.waitForTimeout(50)
  expect((await getBgm(page)).currentCategory).toBe('battle')
})
```

- [ ] **Step 5: 跑测试验证**

Run: `pnpm test`
Expected: core 单测全绿。

Run: `pnpm test:e2e`
Expected: 全部通过——冒险/战斗都有控件；battle 用例验证音量滑块与上一首交互；其余回归仍绿。

- [ ] **Step 6: Commit**

```bash
git add src/ui/BgmControls.ts src/scenes/AdventureScene.ts src/scenes/BattleScene.ts src/e2e/bgm.spec.ts
git commit -m "feat(ui): 共享 BgmControls 组件（含音量滑块）+ 冒险/战斗接入 + 战斗控件 e2e"
```

---

### Task 4: 文档同步（CLAUDE.md / PRD）

**Files:**
- Modify: `CLAUDE.md`（音频节：BgmManager 共享单例 + Loading 预载描述）
- Modify: `PRD.md`（§15 开发状态 / §16 待完成）

**Interfaces:** 无新接口。

- [ ] **Step 1: 更新 `CLAUDE.md` 音频节**

把「BGM」小节改为描述：BGM 为**游戏级共享单例**（`src/audio/BgmManager.ts` 的 `getBgmManager`），音频由 **LoadingScene（Boot）一次性预载**进全局缓存（icon/BGM/SFX），各场景不再自行加载；解锁机制（`unlock()` + 首次手势 `context.resume()`，必要时 Loading 页显示 OK 按钮）；`bgmConfig.json` 三种分类 playlist 统一（menu 单曲 = 主题曲，explore/battle shuffle）；共享 `BgmControls` 组件（含音量滑块）供 Adventure/Battle 复用。同步更新「加载」与「约定」小节使其与实现一致。

- [ ] **Step 2: 更新 `PRD.md` §15/§16**

把本次完成项勾上 `[x]`（loading 页、主菜单淡入、BGM 全自动 + 主题曲、battle 播放控件含音量、menu playlist 同构化），未完成项保持 `[ ]` 并写明差距；确保文档与实现一致。

- [ ] **Step 3: 验证并提交**

Run: `pnpm test`
Expected: 全绿（文档改动不影响代码）。

Run: `pnpm typecheck`
Expected: 无类型错误（commit 前唯一一次 typecheck）。

Run: `pnpm test:e2e`
Expected: 全绿。

```bash
git add CLAUDE.md PRD.md
git commit -m "docs: CLAUDE.md/PRD 同步 loading 预载 + BGM 全自动 + 战斗播放控件"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4.1 LoadingScene（T1/T2）、§4.2 BgmManager 单例（T2）、§4.3 bgmConfig menu playlist（T2）、§4.4 MainMenu 淡入 + theme（T1/T2）、§4.5 Adventure 接线（T2）、§4.6 Battle 接线（T2/T3）、§4.7 共享 BgmControls（T3）、§4.8 dev bridge/e2e（T1/T2/T3）、§4.9 SfxManager（T2）、§4.10 文档（T4）、§5 解锁机制（T2 实现，T1 前已核验）、§6 错误处理（空 keys no-op 在 T2 startCategory/ready 覆盖）、§7 测试计划（各任务验证步骤）。全部覆盖。
- **占位符扫描**：无 TBD/TODO；每步含完整代码。
- **类型一致性**：`getBgmManager(scene: Phaser.Scene)` 各任务一致；`addTrackListener/removeTrackListener` 命名一致；`BgmState` 字段与 spec §4.8 一致；`gotoBooted/gotoAdventure/gotoBattle` 在 helpers 单处定义。
