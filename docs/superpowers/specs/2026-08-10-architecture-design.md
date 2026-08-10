# 三国志：战术传说 — 架构设计文档

> 日期：2026-08-10
> 状态：已确认（方案 A）
> 需求来源：`PRD.md`、`PRD-SUPPLEMENT.md`（权威需求）；本文只沉淀架构与技术决策
> 配套：`CLAUDE.md`（协作规范，含同样约束的命令式表述）

---

## 1. 背景与目标

需求 PRD 从其他 repo 迁移而来，本项目**从零开始**（PRD 中所有 checkbox 均为未完成）。前期只确定了两件事：保留需求清单、重定技术栈。

架构目标，按优先级：

1. **可回归** —— 核心逻辑能无浏览器单测；渲染结果能"截图看到 + 读状态断言"。
2. **可调试** —— 确定性回放，让 bug 能精确复现，而不是"时灵时不灵"。
3. **可持续演进** —— 分层清晰、职责单一，其他 agent 可低成本接手。

## 2. 决策记录（ADR）

### 2.1 技术栈

| 决策 | 选择 | 放弃的备选 | 放弃理由 |
|---|---|---|---|
| 渲染引擎 | **Phaser 4.2** | Phaser 3.80 | 2026 新项目没必要用四年前的引擎；v4 已稳定（v4.0.0 @ 2026-04）、包小 40%、TS 支持更好 |
| | | Athena Crisis 开源引擎 | 现成 TBS 核心，但它是别人的游戏模型（非 HOMM3 英雄式），改造/理解成本高，绑定他人设计；只借鉴其 headless + 确定性回放思路 |
| | | 纯 Canvas 手写 | 相机/场景/补间/输入/UI 全部自造，浪费时间，且与"可回归"目标无关 |
| 语言 | TypeScript（strict） | — | — |
| 构建 | Vite 8 | — | — |
| 测试 | Vitest 4（core）+ Playwright（e2e） | — | 逻辑与视觉两条回归链路 |
| 包管理 | pnpm | npm | 全局规范 |
| 渲染后端 | WebGL2 | Canvas fallback | Phaser 4 已弃用 Canvas 渲染器；2026 年 WebGL2 全兼容，无需回退 |

### 2.2 分辨率

- 设计基准 **1920×1080**（原 800×600 太小，玩家视野过窄）。
- 默认 **RESIZE 自适应**：canvas 撑满窗口，**大屏看更多地图**（相机视野扩大，而非拉伸糊内容）。
- 窗口小于基准：等比缩小 + **最小缩放钳制**；低于下限走 **FIT + 黑边**。
- **可配置覆盖**：`view: { width, height }` 锁死分辨率走 FIT；设置项提供 Auto / 固定档位。

### 2.3 架构模式

- **核心/渲染分离（headless core）**。
- **确定性命令日志**（event-sourcing 风格）：每个操作 = 一个 command。
- **固定种子 RNG 注入**：core 内禁止裸 `Math.random()` / `Date.now()`。

## 3. 分层架构

```
src/
├── main.ts        # 入口：创建 Phaser 游戏，装配渲染层与 core
├── types/         # 全部共享类型（core 与渲染层共用）
├── data/          # 纯数据表：兵种/建筑/武将/技能/地图（不含逻辑）
├── core/          # ── 纯 TS 游戏逻辑，零 Phaser/DOM 依赖 ──
│   ├── hex/       #   六角格数学（轴向坐标，抽象坐标系）
│   ├── pathfinding/#  A* 寻路 + 可达范围
│   ├── state/     #   游戏状态、回合管理、存档序列化
│   ├── combat/    #   伤害公式、反击、士气/幸运、施法
│   ├── economy/   #   资源、城池产出、建筑升级
│   ├── ai/        #   敌方决策（地图 + 战斗）
│   └── events/    #   命令日志：command 定义、分发、回放
├── scenes/        # ── Phaser 4 渲染层 ──
│   ├── BootScene / AdventureScene / CombatScene / TownScene / HeroScene
├── ui/            # HUD、菜单、弹窗（渲染层）
├── dev/           # 开发专用：debug 句柄、脚本化输入（生产构建剔除）
└── e2e/           # Playwright 端到端回归
```

**依赖规则（铁律）**：

```
core  ←──── 渲染层（scenes/ui/main）可以 import core
  │  ←──── 渲染层可以 import data/types
  ╳  core 禁止 import 渲染层 / Phaser / DOM
```

- core 不感知分辨率、不感知输入方式、不感知渲染后端。
- 渲染层职责仅两条：**读 core 状态并渲染**；**把用户输入转成 core command**。

## 4. 核心子系统设计要点

### 4.1 六角格（`core/hex`）

- 轴向坐标（cube → axial），尖顶朝上，半径由渲染层决定。
- core 内 hex 是**抽象坐标**，与像素无关；像素换算函数放渲染层 camera/viewport。
- 提供：坐标运算、距离、六邻居、格子到屏幕坐标的映射函数（供渲染层调用）。

### 4.2 命令日志与确定性（`core/events`）

- 每个游戏操作是一个 command（纯数据对象）：`{ type, payload, seq }`。
- 所有命令追加到日志；状态由命令唯一驱动（函数式 reducer：`state = reducer(state, command)`）。
- **确定性规则**：
  - core 内禁止裸 `Math.random()` / `Date.now()`；
  - 随机一律通过注入的 `RNG`（可固定种子）；
  - 一切输入（含玩家操作、AI 决策）最终都走 command。
- 收益：bug 可用「固定种子 + 命令序列」精确复现；存档 = 日志 + 当前状态快照；支持无头 AI 模拟与回放测试。

### 4.3 战斗 / 经济 / AI

- 公式严格按 PRD §10（HOMM3 风格伤害）与 PRD-SUPPLEMENT（反击/等待/防御/士气/幸运/MP/攻城）。
- 每个公式写成纯函数并配套 Vitest 断言（如：`effectiveAtk > effectiveDef` 边界、反击减半、士气双倍概率边界）。
- AI 输入为只读状态快照，输出 command 序列，同样走确定性 RNG。

### 4.4 状态与存档

- `GameState` 为不可变快照或纯 reducer 输出，便于序列化/比较。
- 序列化用于：存档、e2e 断言、回放测试的"期望状态"比对。

## 5. 渲染层职责（Phaser 4）

- **场景**：Boot / Adventure（大地图）/ Combat（战斗）/ Town（城池）/ Hero（武将界面）。
- **相机/视口**：RESIZE 自适应；像素换算唯一入口；`1920×1080` 基准缩放逻辑在此。
- **UI**：锚定屏幕边缘（顶资源条、底英雄栏、右城池列表），随视口重排。
- **输入**：指针/键盘 → 命中 hex → 转成 core command。
- **dev 调试句柄**：非生产构建下挂 `window.__game`，暴露 `getState()`、`dispatch(cmd)`、`setSeed()`，供 e2e 与人工调试断言真实状态（而非只看像素）。

## 6. 数据流

```
玩家输入 ─→ 渲染层命中测试(hex) ─→ core command
                                     │ reducer
                                     ▼
core GameState（更新） ──→ 事件 ──→ 渲染层订阅 → 重绘
                     └──→ 命令日志追加（可回放/存档）
```

## 7. 测试与回归策略

| 层 | 工具 | 内容 |
|---|---|---|
| 单元 | Vitest | core 全部逻辑：hex 运算、A*、伤害/反击/士气/幸运/MP、经济、AI 决策；固定种子 + 命令序列断言 |
| 端到端 | Playwright | `pnpm dev` 启动 → 模拟点击/按键 → `window.__game.getState()` 断言真实状态（模型无多模态，**不能靠看截图验证**）；截图存 `screenshots/` 交人工目检 |
| 回放 | Vitest | 命令日志重放测试：同种子同命令序列 → 同终态 |

回归基线：每个 core 模块至少一套"输入→输出"确定性用例；e2e 至少覆盖「开局 → 移动 → 遭遇 → 战斗 → 回城」主流程。

## 8. 实施顺序建议（衔接实现计划）

1. **脚手架**：Vite 8 + Phaser 4.2 + TS strict + pnpm + Vitest + Playwright 接通；跑通"截图看界面 + 读状态"链路。
2. **core 地基**：hex → pathfinding → events（命令日志 + RNG 注入）→ state，每步带单测。
3. **P0 功能**（PRD §16）：按"开局选将 → 技能/升级 → 资源 → 城池收入 → 战斗进阶"顺序，均为"core 逻辑 + 单测 + 渲染层接入 + e2e"四件套。
4. **P1+** 依次推进。

## 9. 范围外（本阶段不做）

美术资源、音效/BGM、主菜单与剧本系统、多种胜利条件、小地图、网络/多人（无）。像素风以"色块 + 系统字体"占位（PRD-SUPPLEMENT §1.0）。
