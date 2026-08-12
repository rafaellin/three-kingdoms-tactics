# 设计：Loading 预载 + 全自动 BGM + 战斗页播放控件（2026-08-12）

## 1. 背景与目标

当前状态：

- 游戏直接进入主菜单（`MainMenuScene`），无 loading 页；资源（icon/BGM/SFX）在各自场景 `preload()` 里懒加载。
- 主菜单**无 BGM**；进入 Adventure 后 BGM 虽自动切到 explore，但浏览器自动播放策略要求**先有一次鼠标点击**才能出声，体验不完整。
- Battle 场景无 BGM、无播放控件；Adventure 的内联 BGM 控件（上一首/曲名/下一首/音量）无法复用。
- `bgmConfig.json` 里主题曲是**特殊字段** `themeSong`，与 explore/battle 的 playlist 结构不一致。

目标：

1. 进入主菜单前增加 **Loading 页**，一次预载游戏所需资源（icon、BGM、SFX）。
2. 加载完成 → 进入主菜单；主菜单**淡入动画**，动画结束前按钮不可点。
3. **BGM 全自动**：主菜单自动播主题曲；点「开始游戏」→ explore；点「战斗测试」→ battle。若引擎要求用户手势，loading 页在完成后显示 **OK 按钮**，单击解锁并起播。
4. 战斗页获得与冒险页**完全一致（含音量）**的左下角播放控件。
5. **主题曲改为统一的 `menu` playlist**（内含一首），与其它分类同构，删除 `themeSong` 特殊分支。

## 2. 场景流转总览

```
[LoadingScene] ──预载 icon/BGM/SFX──> 主题曲起播 ──> [MainMenuScene] 淡入 ──> [AdventureScene] (explore)
                   ▲ 音频被锁时显示 OK 按钮                               └──> [BattleScene]  (battle + 控件)
```

BGM 为**游戏级共享单例**，跨场景持续播放不中断；切场景只换 playlist，不重新加载、不重新解码。

## 3. 架构决策（已确认）

### 3.1 BgmManager 共享单例 + Boot 预载（方案 A）

- 新增 `LoadingScene` 放在 `scene:` 数组**第一位**，负责一次性预载全部资源进 Phaser 全局缓存。
- `BgmManager` 重构为模块级单例（`getBgmManager(scene)`），不再随场景生灭：
  - 移除构造函数里的 `scene.load.audio(...)` 注册、`scene.events.once('shutdown', dispose)`、场景级 `input/keyboard` 手势绑定。
  - 音频生命周期归游戏；解锁状态全局；场景切换只调 `switchToCategory(...)`。

### 3.2 menu playlist 统一（用户要求）

- `bgmConfig.json`：删除 `themeSong` 字段，`categories` 增加 `"menu": ["Neon Jade"]`。
- `BgmManager`：三种分类走**同一套 playlist 逻辑**，删除 `startMenuTheme()` 与 `nextTrack/prevTrack/playCurrent` 中的 `'menu'` 特判。
- 单曲 playlist（menu）天然成为「单曲循环」；播放细节见 §5.2。

## 4. 详细设计

### 4.1 LoadingScene（新文件 `src/scenes/LoadingScene.ts`）

- `main.ts` 的 `scene: [LoadingScene, MainMenuScene, AdventureScene, BattleScene]`。
- **`preload()`**：把现有 `AdventureScene.preload()` 里的 `ICON_URLS` glob、`BGM_URLS` glob、`SfxManager` 的 `SFX_URLS` glob 全部集中于此，`scene.load.image(...)` / `scene.load.audio(...)`。
- **进度反馈**：`preload()` 中 `this.load.on('progress', cb)` 更新一个 `Graphics` 进度条 + 「加载中…」文字（preload 阶段可用 `this.add.graphics()`/`this.add.text()` 绘制）。
- **`create()`**（preload 自动完成后进入）：
  1. `bgm.unlock()` —— 幂等，安装 document 级首次手势解锁监听（机制见 §5）。
  2. 分支：
     - 若 `game.sound.unlocked === true`（已有用户手势）→ `bgm.switchToCategory('menu')` → `this.scene.start(MainMenuScene.KEY)`。
     - 否则显示 **OK 按钮**；单击 → `bgm.switchToCategory('menu')` → `this.scene.start(MainMenuScene.KEY)`（该次单击即触发 unlock 监听 → `context.resume()`，主题曲随之响起）。
- `getDebugState()`：返回 `{ scene: 'loading', ready: true, loaded: <progress>, ... }` 供 dev bridge / e2e。

### 4.2 BgmManager 重构（`src/audio/BgmManager.ts`）

- 新增 `getBgmManager(scene: Phaser.Scene): BgmManager`（模块级单例缓存，内部持 `scene.game`）。
- 字段调整：
  - 移除 `scene` 私有构造注入、`gestureHandler`、`interacted`。
  - 新增 `unlocked` 标志（本管理器视角的解锁状态）与 `unlock()` 方法。
- **`unlock()`**：`if (this.unlocked) return; this.unlocked = true; this.game.sound.unlock()`；随后若 `ready && pendingCategory` → `startCategory(pendingCategory)`。
- **`ready` 判定**：构造时 `keys` 全部已在 `game.cache.audio` 中（`game.cache.audio.has(key)`），或 `keys` 为空 → `ready = true`；否则 `ready = false`（Boot 保证已加载，通常恒为 true）。
- **`switchToCategory(cat)`**：记 `pendingCategory`；`if (ready && unlocked)` 立即 `startCategory(cat)`，否则待 `unlock()`/加载完成时补执行。
- **`onTrackChange` 改多监听**：`addTrackListener(cb)` / `removeTrackListener(cb)`（`Set<() => void>`），替换原单槽 `setTrackChangeCallback`。控件构造时注册、`destroy()` 时注销。
- `playCurrent()` 里 `this.scene.sound` 全部改为 `this.game.sound`（全局共享管理器，场景无关）。
- `stopCurrent()` 仅在 `startCategory`/`dispose` 内调用；跨场景不主动 stop（音乐持续）。

### 4.3 bgmConfig.json

```json
{
  "categories": {
    "menu":    ["Neon Jade"],
    "battle":  ["Silk and Steel", "Iron and Silk", "Ba Men Jin Suo", "A Thousand Miles", "Farewell", "Chi Bi", "Hu Lao Guan", "Lone Blade"],
    "explore": ["The River", "Tao Yuan", "Luo Yang"]
  }
}
```

- `playlist.ts` 的 `buildPlaylist(tracks, theme, rng)`（主题曲优先）不再被 BgmManager 使用；保留或标记 deprecated（`buildShuffledPlaylist` 仍用）。

### 4.4 MainMenuScene 改造（`src/scenes/MainMenuScene.ts`）

- `create()`：`const bgm = getBgmManager(this); if (bgm.getState().currentCategory !== 'menu') bgm.switchToCategory('menu')`。
  - 从 Loading 进入时当前已是 menu → 不重复起播；从 Battle 返回时 → 自动切回主题曲。
- **淡入**：标题 + 两按钮初始 `alpha 0`、**不** `setInteractive`；tween 至 `alpha 1`（约 500ms，`Ease.OutCubic`），`onComplete` 后才 `setInteractive(true)` 并绑定 `pointerdown`。
- `getDebugState()`：`{ scene: 'menu', ready: true, menu: { buttonsEnabled: boolean }, bgm: bgm.getState() }`。

### 4.5 AdventureScene 接线（`src/scenes/AdventureScene.ts`）

- 删除 `new BgmManager(this)` + `this.bgm.load()`；`this.bgm` 改为 `getBgmManager(this)` 返回值（或直接局部）。
- `create()`：`bgm.switchToCategory('explore')`。
- 删除内联控件字段与方法（`bgmPrevBtn/bgmLabel/bgmNextBtn/bgmVolumeBtn/bgmSlider/bgmSliderVisible/bgmSliderDragging`、`refreshBgmLabel/toggleBgmSlider/showBgmSlider/hideBgmSlider/drawBgmSlider/updateSliderFromPointer/repositionBottomControls` 中的 BGM 部分），替换为共享 `BgmControls` 组件（见 §4.7）。
- `getDebugState()` 的 `bgm` 改从共享单例读取。
- `setBgmVolume(v)` 保留但转发到单例（供 dev bridge）。

### 4.6 BattleScene 接线（`src/scenes/BattleScene.ts`）

- `create()`：`getBgmManager(this).switchToCategory('battle')`。
- 左下角创建共享 `BgmControls` 组件（含音量）。Battle 是单相机，控件 `scrollFactor(0)` 即可，`hooks.onCreateObject` 传 no-op。
- `getDebugState()`：新增 `{ scene: 'battle', ..., bgm: getBgmManager(this).getState() }`。
- 返回主菜单（现有 `scene.start(MainMenuScene.KEY)`）无需额外处理——MainMenu.create 会切回 menu。

### 4.7 共享 BgmControls 组件（增强 `src/ui/BgmControls.ts`）

- 现有 `BgmControls` 只有上一首/曲名/下一首，且未被 import（死代码）。增强为**完整版**（从 AdventureScene 内联实现迁移）：
  - 上一首 / 曲名标签 / 下一首 / 音量按钮 / 音量滑块（轨道+填充+手柄，单 `Graphics`）。
  - 构造签名：`new BgmControls(scene, bgm, hooks?)`，`hooks?.onCreateObject?: (obj) => void` 供 Adventure 传 `uiOnly`、Battle 传 no-op。
  - 构造时 `bgm.addTrackListener(() => this.refresh())`；`destroy()` 移除监听并销毁全部对象。
  - `refresh()`：更新曲名、音量图标（🔇/🔈/🔉/🔊）、滑块位置与交互（`pointermove/pointerup` 用 `scene.input` 绑/解绑，参照现实现）。
  - 位置：左下角 `y = scene.cameras.main.height - 56`，横向布局同现实现。
- 控件创建时 `setScrollFactor(0)`、`setDepth` 层级参照现实现（按钮 12、滑块 13）。

### 4.8 dev bridge / e2e（`src/dev/debug.ts`、`src/e2e/*`）

- `getActive()` 扩展：依次检查 Loading/MainMenu/Adventure/Battle 的 active 场景，返回其 `getDebugState()`。
- `setBgmVolume` 改走 `getBgmManager(game).setVolume(v)`（全局音量）；`setSfxVolume` 保持现状。
- `helpers.ts`：
  - 新增 `gotoBooted(page)`：`goto('/')` → 等 canvas → 等 `getState().scene === 'menu'` 或 OK 按钮出现。
  - 若出现 OK 按钮（loading 完成、音频被锁）→ 点击解锁。
  - 等 `menu.buttonsEnabled === true`（淡入完成）。
  - `gotoAdventure`：`gotoBooted` → 点 `MENU_START` → 等 `getState().ready === true`。
  - 新增 `gotoBattle`：`gotoBooted` → 点 `MENU_BATTLE` → 等 battle ready。
- `bgm.spec.ts` 语义重写：
  - menu 阶段：`currentCategory === 'menu'`、`currentTrack === 'Neon Jade'`、`playing === true`（主题曲自动播放，无需点击）。
  - adventure 阶段：`currentCategory === 'explore' && playing === true`（自动，不再需要点地图）。
- `sfx.spec.ts`、`camera.spec.ts`：适配新导航流程（都走 `gotoAdventure`）。
- 新增 `battle-bgm.spec.ts`（或并入 bgm.spec）：进入 battle → 断言 `currentCategory === 'battle'`、控件存在、上一首/下一首/音量按钮可交互、音量滑块拖动改 `getState().bgm.volume`。

### 4.9 SfxManager 小改（`src/audio/SfxManager.ts`）

- 构造时改为「检查 keys 已在 `game.cache.audio` → `ready = true`」，不再注册 `scene.load.audio`。
- `load()` 保留为兼容但立即 resolve（AdventureScene 调用点可保留或移除）。
- 其余（`playLooped/stopLooped/setVolume`）不变；仍 per-scene 实例，`shutdown` 时 `stopLooped()` 清理。

### 4.10 文档同步

- `CLAUDE.md` 音频节：BgmManager 描述更新为「共享单例 + Loading 预载」；补充 Loading 流程与解锁机制。
- `PRD.md` §15/§16：勾选/更新 loading 页、主菜单淡入、battle 播放控件、主题曲自动播放、menu playlist 同构化。

## 5. 音频解锁机制（关键验证结论）

- Phaser `sound.unlock()` 只**安装** document.body 上的 `touchstart/touchend/mousedown/mouseup/keydown` 监听（bubble 阶段），首次手势内调 `context.resume()`，resolve 后置 `unlocked = true` 并移除监听；**不**在调用时同步 resume。
- Phaser 把 `mousedown` 绑在 **canvas**（target 阶段）并同步处理输入：一次单击时，canvas 的 `onMouseDown` → 同步派发 `pointerdown` → 我们的 OK 处理函数运行 → `sound.unlock()` 装上 body 监听 → **同一事件继续冒泡到 body** 时触发 unlockHandler → `context.resume()`。故 **OK 单击即完成「解锁 + 起播」**，无需第二次点击。
- `game.sound.unlocked` 是 Phaser 的解锁标志；`BgmManager.unlocked` 是本管理器自己的同步标志（OK 处理函数里先置位再 `switchToCategory`，保证同一次单击内逻辑起播成功）。
- e2e（headless）中单击 OK/开始游戏同样产生真实手势，机制一致，`playing` 状态可断言。

## 6. 错误处理与边界

- `keys` 为空（无音频资源）：`ready = true`，各 `switchToCategory` 静默 no-op，游戏功能不受影响。
- 某分类曲目不在 `keys`（文件名不匹配/缺失）：`available` 过滤后为空 → 不切换分类、不报错（沿用现行为）。
- `context.resume()` reject（极少数被拒）：Phaser 的 unlockHandler 会移除监听但不置 unlocked；`BgmManager.unlocked` 已置位，逻辑照常 `playing`，浏览器静音——不影响游戏性，e2e 不依赖真实出声。
- Loading 页 OK 按钮点击后若 `game.sound.unlocked` 仍未置位（headless 边界）：仍过渡到主菜单，主题曲逻辑状态为 playing；主菜单 `switchToCategory('menu')` 因已是 menu 分类跳过，不重复起播。

## 7. 测试计划

- core 单测：无新 core 逻辑（`playlist.ts` 不变），`pnpm test` 保持绿。
- e2e（`pnpm test:e2e`）：
  - loading → OK（如出现）→ 主菜单：断言 `scene==='menu'`、`menu.buttonsEnabled===false→true`、主题曲 `currentCategory==='menu' && currentTrack==='Neon Jade' && playing`。
  - 开始游戏 → adventure：`currentCategory==='explore'`、`playing`；现有 camera/sfx/battle 回归全部走新 `gotoAdventure`/`gotoBattle`。
  - 战斗测试 → battle：`currentCategory==='battle'`、控件存在、上一首/音量交互断言。
  - battle 返回主菜单：主题曲恢复（`currentCategory==='menu'`）。
- commit 前 `pnpm typecheck` 一次。

## 8. 影响面

| 文件 | 改动 |
|---|---|
| `src/scenes/LoadingScene.ts` | 新增 |
| `src/main.ts` | scene 数组加 LoadingScene |
| `src/audio/BgmManager.ts` | 单例化 + unlock + 多监听 + menu 统一 |
| `src/audio/SfxManager.ts` | 读缓存、load 变 no-op |
| `src/audio/playlist.ts` | `buildPlaylist` 不再被用（保留 deprecated） |
| `src/data/bgmConfig.json` | 删 themeSong、加 menu 分类 |
| `src/scenes/MainMenuScene.ts` | 淡入 + 按钮延迟 enable + 切 menu 分类 |
| `src/scenes/AdventureScene.ts` | 换共享控件 + 单例 BGM |
| `src/scenes/BattleScene.ts` | battle 分类 + 控件 |
| `src/ui/BgmControls.ts` | 增强为完整版并接线 |
| `src/dev/debug.ts` | getActive 扩展 + setBgmVolume 走单例 |
| `src/e2e/helpers.ts` + specs | 新导航流程 + 语义重写 |
| `CLAUDE.md` / `PRD.md` | 文档同步 |
