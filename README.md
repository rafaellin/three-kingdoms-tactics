# 三国志：战术传说 · Three Kingdoms: Tactics Legend

类《英雄无敌 3》（HOMM3）的 **六角格回合制策略游戏**，Web 平台。

当前为 **P0 基础版**：六角大地图探索 + 战争迷雾 + 四势力（魏/蜀/吴/群）回合轮转 + 资源经营（金/木/石/铁），含宝箱拾取、资源矿占领与每日结算、城池收入、顶部 HUD。战斗、武将养成、AI 等仍在规划中（见 [`PRD.md` §16](PRD.md)）。

> 需求与设计请读 [`PRD.md`](PRD.md) 与 [`PRD-SUPPLEMENT.md`](PRD-SUPPLEMENT.md)（权威需求文档）；协作规范见 [`CLAUDE.md`](CLAUDE.md)（**先读它再读 PRD**）。

---

## 快速开始

环境要求：Node.js ≥ 20 与 [pnpm](https://pnpm.io/)（**本项目禁止使用 npm**）。

```bash
pnpm install      # 安装依赖
pnpm dev          # 开发服务器 → http://localhost:3000
```

常用脚本（`package.json`）：

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动 Vite 开发服务器（默认端口 **3000**） |
| `pnpm test` | core 单元测试（Vitest，无浏览器，快） |
| `pnpm test:e2e` | Playwright 端到端回归（独立端口 **3100**，与 dev 隔离） |
| `pnpm typecheck` | `tsc --noEmit` 全量类型检查（提交前跑） |
| `pnpm build` | 类型检查 + 生产构建 |

## 技术栈（2026-08 已确认，勿擅自改动）

| 项 | 选择 |
|---|---|
| 语言 | TypeScript（**strict**，`noUncheckedIndexedAccess` 等全开） |
| 引擎 | **Phaser 4.2**（仅渲染层，**禁止在游戏逻辑中使用**） |
| 构建 | Vite 8 |
| 测试 | Vitest 4（core 单测）+ Playwright（e2e） |
| 包管理 | **pnpm**（禁止 npm） |
| 分辨率 | 设计基准 1920×1080，默认 `RESIZE` 自适应，可配置固定分辨率 |

## 核心架构：core / 渲染分离（铁律）

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│  src/scenes, src/ui, main   │        │        src/core           │
│       Phaser 渲染层          │  ──►   │   纯 TS 游戏逻辑           │
│  读 core 状态渲染 / 输入→命令 │  单向   │  零 Phaser/DOM/浏览器依赖   │
└─────────────────────────────┘ 依赖   └──────────────────────────┘
                 src/data = 纯数据表（兵种/建筑/武将/资源点…，不含逻辑）
```

- **`src/core/`** — 纯 TS：六角格、寻路、迷雾、状态机、资源经济、事件日志。**零 Phaser / DOM / 浏览器依赖**，不得感知分辨率，不得 import 渲染层。每个模块可被 Vitest 无浏览器直接测试。
- **`src/scenes/`、`src/ui/`、`src/main.ts`** — Phaser 渲染层，职责只有两条：① 读取 core 状态并渲染（单向依赖）；② 把用户输入转换成 core 的 command。
- **`src/data/`** — 纯数据表（资源点定义、初始武将/城池/资源），不含逻辑。

### 确定性（不可破坏）

- 每个游戏操作是一个 **command（事件）**，追加进事件日志（`src/core/events/CommandLog.ts`）；任意状态可由 `createInitialState + 事件日志` 精确重放。
- **core 内禁止裸 `Math.random()` / `Date.now()`** —— 所有随机必须走注入的 RNG（固定种子）。
- 确定性使 bug 可精确复现、存档/回放/无头 AI 模拟成为可能——这是本项目调试的根基。
- core 只用抽象六角格坐标；像素换算只存在于渲染层，改分辨率不动 core。

## 目录结构

```
src/
├── core/                  # 纯 TS 游戏逻辑（无 Phaser/DOM）
│   ├── events/            #   CommandLog：事件溯源 + 确定性重放
│   ├── hex/               #   六角格坐标/布局（轴向坐标系）
│   ├── map/               #   确定性地图生成（地形 + 资源点）
│   ├── fog/               #   战争迷雾（explored / unexplored）
│   ├── pathfinding/       #   A* 寻路 + 地形移动代价
│   ├── state/             #   GameState / reducer / 每日结算
│   ├── rng.ts             #   注入式随机数（固定种子）
│   └── testing/           #   单测辅助（makePlainMap / makeSetup）
├── scenes/                # Phaser 场景（当前 AdventureScene：大地图）
├── audio/                 # 渲染层音频（BGM/Sfx，不进 core）
├── data/                  # 纯数据表（资源点/初始武将/城池/bootstrap）
├── dev/                   # window.__game 调试桥（e2e 用）
├── e2e/                   # Playwright 端到端回归
└── main.ts                # Phaser 入口（RESIZE + WebGL）
assets/
├── icons/                 # Kenney Board Game Icons（CC0，纯白剪影 → setTint 上色）
├── bgm/ mp3/ wav/         # 背景音乐（wav 为玩家原声碟，不加载）
└── sound/                 # 音效
```

## 测试与回归工作流

> **重要**：界面验证一律以**程序化断言**为准，截图只作为给人看的产物（存 `screenshots/`，已被 gitignore，由人工目检）。**不要**用像素颜色分析等方式替代看图。

1. **逻辑回归** — `pnpm test`：寻路、伤害公式、每日结算等在 core 层直接断言，不依赖浏览器。
2. **界面回归** — `pnpm test:e2e`：启动游戏 → 模拟点击/按键 → 通过 `window.__game.getState()` 断言真实游戏状态。**断言写进测试代码**，不靠截图。
3. **出 bug**：优先用「固定种子 + 事件日志」在 core 层复现，再修。
4. **截图**：e2e 顺手存 `screenshots/*.png`，由人目检界面观感。

### 调试桥（dev-only）

浏览器控制台可访问 `window.__game`：

```js
window.__game.getState()            // 真实游戏状态（turn/week/资源/英雄/视野…）
window.__game.setSeed(8)            // 换确定性种子重建地图
window.__game.setAnimationSpeed(0)  // 0 = 瞬间移动（e2e 常用）
window.__game.waitForMove()         // 等待移动动画结束
window.__game.setBgmVolume(0.3)     // 音量接线点（未来"设置"界面）
window.__game.setSfxVolume(0.3)
```

## 资源与许可

- 图标：Kenney Board Game Icons（**CC0**，免署名），见 `assets/icons/README.md`。Kenney 图标为纯白剪影，渲染层用 `setTint` 按资源代表色上色。
- 音频：`assets/bgm/`、`assets/sound/`（自动发现，新增文件无需改代码）。

## 当前开发状态

已完成（见 [PRD §15](PRD.md)）：大地图移动/迷雾/音频、回合制轮换（E 键/按钮）、资源系统（宝箱拾取、资源矿占领、每日结算、城池收入）、HUD（资源条 + `(+每日产出)` + hover 明细）、确定性地图生成。

待完成（按优先级，见 [PRD §16](PRD.md)）：开局选将、技能系统、武将升级、战斗、攻城战、AI 敌方英雄、市场交易、建筑等。

---

License：未指定（私人项目）。
