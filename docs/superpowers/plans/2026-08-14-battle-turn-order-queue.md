# 战斗行动顺序条（TurnOrderQueue）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在战斗场景底部加一条全宽「行动顺序条」，按 `state.order` 显示当前回合行动顺序（方块底色=兵种格子同色、中央兵种大字、当前单位黄框高亮、已行动灰掉），跨回合自动重排，且纯显示不拦截地图交互。

**Architecture:** 数据完全派生自 core（`state.order` / `currentUnitId` / `hasActed` 已存在，`advance()` 已在回合结束按速度重排）——新增一个纯函数 `buildTurnOrderQueue` 把 order 映射为视图条目（跳阵亡残留），新增渲染层组件 `TurnOrderQueue`（通栏条 + 方块 Graphics + 文字 Map，非 interactive），BattleScene 用 `syncViews()` 统一刷新玩家与敌方回合。

**Tech Stack:** Phaser 4.2（仅渲染层）、TypeScript strict、Vitest（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- core（`src/core/`）零 Phaser / DOM 依赖；渲染层可 import core，core 禁止 import 渲染层。
- core 新增逻辑必须配套 Vitest 单测（同目录 `*.test.ts`），断言确定性输入 → 输出。
- 包管理用 **pnpm**（不用 npm）。
- 中文注释 / 中文 commit 描述；标识符用英文。
- 颜色/像素坐标只存在于渲染层；`pnpm test`（core 单测）改动后照跑，`pnpm typecheck` 每任务 gate 一次（提交前必跑）。
- PRD §15/§16 需与实现保持一致（本次完成后更新 §15 战斗（MVP）段）。
- git 操作经 PowerShell 逐条调用（本机 git 走 SSH key）。
- e2e 视口固定 1920×1080（`playwright.config.ts`）；战斗横条：高 88px → 屏幕 y∈[992,1080]，中心 y=1036。

---

### Task 1: core `buildTurnOrderQueue` 纯函数 + 单测

**Files:**
- Create: `src/core/battle/queue.ts`
- Test: `src/core/battle/queue.test.ts`

**Interfaces:**
- Produces: `TurnOrderEntry`（`{ unitId: string; side: Side; defId: UnitDefId; hasActed: boolean }`）与 `buildTurnOrderQueue(state: Pick<BattleState, 'order' | 'units'>): TurnOrderEntry[]`。Task 3 的组件与 Task 4 的 `getDebugState` 都消费它。

- [ ] **Step 1: 写失败单测**

创建 `src/core/battle/queue.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTurnOrderQueue } from './queue'
import type { BattleUnit } from './types'

function unit(id: string, over: Partial<BattleUnit> = {}): BattleUnit {
  return {
    id,
    side: 'player',
    defId: 'militia',
    count: 10,
    position: { q: 0, r: 0 },
    size: 1,
    hpLeft: 100,
    maxHp: 100,
    hasActed: false,
    hasMoved: false,
    retaliated: false,
    ...over
  }
}

describe('buildTurnOrderQueue', () => {
  it('按 state.order 顺序产出条目，透传 side/defId/hasActed', () => {
    const units = [
      unit('p1', { defId: 'militia', hasActed: true }),
      unit('p0', { defId: 'cavalry' }),
      unit('e0', { side: 'enemy', defId: 'archer' })
    ]
    const q = buildTurnOrderQueue({ order: ['e0', 'p1', 'p0'], units })
    expect(q.map((e) => e.unitId)).toEqual(['e0', 'p1', 'p0'])
    expect(q[0]).toEqual({ unitId: 'e0', side: 'enemy', defId: 'archer', hasActed: false })
    expect(q[1]).toEqual({ unitId: 'p1', side: 'player', defId: 'militia', hasActed: true })
    expect(q[2]).toEqual({ unitId: 'p0', side: 'player', defId: 'cavalry', hasActed: false })
  })

  it('跳过已在 order 但已阵亡（不在 units 中）的单位', () => {
    const units = [unit('p0'), unit('p2')]
    const q = buildTurnOrderQueue({ order: ['p0', 'e0', 'p1', 'p2'], units })
    expect(q.map((e) => e.unitId)).toEqual(['p0', 'p2'])
  })

  it('order 重建（跨回合重排）后队列随之变化', () => {
    const units = [
      unit('p0', { defId: 'cavalry' }),
      unit('p1', { defId: 'archer' }),
      unit('p2', { defId: 'militia' })
    ]
    const firstRound = buildTurnOrderQueue({ order: ['p0', 'p1', 'p2'], units })
    expect(firstRound.map((e) => e.defId)).toEqual(['cavalry', 'archer', 'militia'])
    const nextRound = buildTurnOrderQueue({ order: ['p1', 'p0', 'p2'], units })
    expect(nextRound.map((e) => e.unitId)).toEqual(['p1', 'p0', 'p2'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `Cannot find module './queue'`（函数未定义）。

- [ ] **Step 3: 实现最小代码**

创建 `src/core/battle/queue.ts`：

```ts
/**
 * 行动顺序条视图数据派生（纯函数，零 Phaser）。
 * 从 BattleState 派生「当前回合行动顺序条」要显示的条目：
 * 按 state.order 顺序，跳过已阵亡单位在 order 里的残留 id。
 * 跨回合重排由 battleReducer.advance() 负责（order 已按剩余部队当前速度重建），本函数只做投影。
 */
import type { UnitDefId } from '../../data/units'
import type { BattleState, BattleUnit } from './types'

export interface TurnOrderEntry {
  unitId: string
  side: BattleUnit['side']
  defId: UnitDefId
  hasActed: boolean
}

export function buildTurnOrderQueue(state: Pick<BattleState, 'order' | 'units'>): TurnOrderEntry[] {
  const byId = new Map(state.units.map((u) => [u.id, u]))
  const entries: TurnOrderEntry[] = []
  for (const id of state.order) {
    const unit = byId.get(id)
    if (!unit) continue
    entries.push({ unitId: unit.id, side: unit.side, defId: unit.defId, hasActed: unit.hasActed })
  }
  return entries
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: PASS（`src/core/battle/queue.test.ts` 3 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/core/battle/queue.ts src/core/battle/queue.test.ts
git commit -m "feat: 行动顺序条核心派生函数 buildTurnOrderQueue（含跳阵亡残留单测）"
```

---

### Task 2: 把 `SIDE_COLORS` 上提到 theme（单源，网格与队列共用）

**Files:**
- Modify: `src/ui/theme.ts`（追加导出）
- Modify: `src/scenes/BattleScene.ts:18`（删本地常量）、`src/scenes/BattleScene.ts:267`（换用）

**Interfaces:**
- Produces: `BATTLE_SIDE_COLORS: Readonly<{ player: number; enemy: number }>`（值 `{ player: 0x33aa44, enemy: 0xcc3333 }`）。Task 3 的组件消费它。

- [ ] **Step 1: theme 追加势力色 token**

在 `src/ui/theme.ts` 末尾追加：

```ts
/** 战斗双方势力色（单位六边形格与行动顺序条方块共用；保证两处底色一致） */
export const BATTLE_SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const
```

- [ ] **Step 2: BattleScene 改用 theme 常量**

- 删除 `src/scenes/BattleScene.ts:18` 的 `const SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const`；
- 在 import 区加 `import { BATTLE_SIDE_COLORS } from '../ui/theme'`；
- 把 `src/scenes/BattleScene.ts:267` 的 `SIDE_COLORS[unit.side]` 改为 `BATTLE_SIDE_COLORS[unit.side]`。

- [ ] **Step 3: 验证 + 提交**

Run: `pnpm typecheck`（Expected: 无错误，颜色常量已收口到单源）
Run: `pnpm test`（Expected: core 单测仍全绿，本任务不影响 core）

```bash
git add src/ui/theme.ts src/scenes/BattleScene.ts
git commit -m "refactor: SIDE_COLORS 上提到 theme 为 BATTLE_SIDE_COLORS（网格与行动顺序条共用单源）"
```

---

### Task 3: 渲染层组件 `TurnOrderQueue`

**Files:**
- Create: `src/ui/TurnOrderQueue.ts`

**Interfaces:**
- Consumes: `buildTurnOrderQueue` / `TurnOrderEntry`（Task 1）、`BATTLE_SIDE_COLORS`（Task 2）、`UNIT_DEFS[defId].gridLabel`、`BattleState`。
- Produces: `class TurnOrderQueue { constructor(scene: Phaser.Scene); render(state: BattleState): void; setVisible(v: boolean): void; isVisible(): boolean; destroy(): void }`。Task 4 的 BattleScene 使用它。

- [ ] **Step 1: 实现组件**

创建 `src/ui/TurnOrderQueue.ts`：

```ts
import Phaser from 'phaser'
import { buildTurnOrderQueue } from '../core/battle/queue'
import type { BattleState } from '../core/battle/types'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_SIDE_COLORS } from './theme'

/** 队列方块边长 / 间距 / 通栏条高度（px） */
const BLOCK = 46
const GAP = 8
const BAR_H = 88

/**
 * 战斗行动顺序条（渲染层，纯显示）。
 * 贴视口底部的全宽通栏条，方块按 state.order 水平居中排布。
 * MVC：视图只读 buildTurnOrderQueue(state) + currentUnitId，无独立队列状态。
 * 不设 setInteractive → 不拦截地图拖拽/滚轮/点击（横条上交互原样传给地图）。
 */
export class TurnOrderQueue {
  private readonly bar: Phaser.GameObjects.Graphics
  private readonly squares: Phaser.GameObjects.Graphics
  private readonly labels = new Map<string, Phaser.GameObjects.Text>()
  private lastState: BattleState | null = null
  private visible = true

  constructor(private readonly scene: Phaser.Scene) {
    this.bar = scene.add.graphics().setDepth(10).setScrollFactor(0)
    this.squares = scene.add.graphics().setDepth(11).setScrollFactor(0)
    this.drawBar()
    scene.scale.on('resize', this.onResize)
  }

  /** 从 state 重绘整个队列（方块底色/大字/黄框高亮/灰态） */
  render(state: BattleState): void {
    this.lastState = state
    const entries = buildTurnOrderQueue(state)
    const w = this.scene.cameras.main.width
    const totalW = entries.length * BLOCK + (entries.length - 1) * GAP
    const startX = w / 2 - totalW / 2
    const y = this.scene.cameras.main.height - BAR_H / 2
    this.squares.clear()
    const seen = new Set<string>()
    entries.forEach((e, i) => {
      const x = startX + i * (BLOCK + GAP) + BLOCK / 2
      const x0 = x - BLOCK / 2
      const y0 = y - BLOCK / 2
      // 底色 = 兵种六边形格子同色（BATTLE_SIDE_COLORS 单源）
      this.squares.fillStyle(BATTLE_SIDE_COLORS[e.side], 1)
      this.squares.fillRect(x0, y0, BLOCK, BLOCK)
      // 已行动 → 叠半透明黑灰「灰掉」；未行动 → 保持原色
      if (e.hasActed) {
        this.squares.fillStyle(0x000000, 0.55)
        this.squares.fillRect(x0, y0, BLOCK, BLOCK)
      }
      // 当前行动单位 → 黄框高亮（与战场当前单位高亮同色 0xffcc33）；其余细黑描边
      if (e.unitId === state.currentUnitId) {
        this.squares.lineStyle(3, 0xffcc33, 1)
        this.squares.strokeRect(x0, y0, BLOCK, BLOCK)
      } else {
        this.squares.lineStyle(1, 0x000000, 0.4)
        this.squares.strokeRect(x0, y0, BLOCK, BLOCK)
      }
      // 中央兵种大字（gridLabel；文字对象复用，单位消失时销毁）
      let label = this.labels.get(e.unitId)
      if (!label || !label.active) {
        label = this.scene.add
          .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(11)
          .setScrollFactor(0)
        this.labels.set(e.unitId, label)
      }
      label.setPosition(x, y)
      label.setText(UNIT_DEFS[e.defId].gridLabel)
      label.setColor(e.hasActed ? '#7a808a' : '#ffffff')
      seen.add(e.unitId)
    })
    // 清理已不在队列中的文字对象（单位阵亡 / order 收缩）
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy()
        this.labels.delete(id)
      }
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.bar.setVisible(visible)
    this.squares.setVisible(visible)
    for (const t of this.labels.values()) t.setVisible(visible)
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize)
    this.bar.destroy()
    this.squares.destroy()
    for (const t of this.labels.values()) t.destroy()
    this.labels.clear()
  }

  private readonly onResize = (): void => {
    this.drawBar()
    if (this.lastState) this.render(this.lastState)
  }

  /** 全宽通栏条：半透明墨色底（与网格底色同系）；resize 时重绘宽度 */
  private drawBar(): void {
    const cam = this.scene.cameras.main
    this.bar.clear()
    this.bar.fillStyle(0x1a2333, 0.72)
    this.bar.fillRect(0, cam.height - BAR_H, cam.width, BAR_H)
  }
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误（此时 BattleScene 尚未接线，组件本身类型自洽）。

- [ ] **Step 3: 提交**

```bash
git add src/ui/TurnOrderQueue.ts
git commit -m "feat: 行动顺序条渲染组件 TurnOrderQueue（通栏条+方块+黄框高亮+灰态，非 interactive）"
```

---

### Task 4: BattleScene 接线 + `syncViews()` 重构 + `getDebugState.turnQueue`

**Files:**
- Modify: `src/scenes/BattleScene.ts`（字段/import、createLayers、shutdown、refreshViews、stepEnemyAi、updateLogAndResult、getDebugState）

**Interfaces:**
- Consumes: `TurnOrderQueue`（Task 3）、`buildTurnOrderQueue`（Task 1）。
- Produces: `getDebugState()` 返回值新增 `turnQueue: TurnOrderEntry[]`。Task 5 的 e2e 断言它。

- [ ] **Step 1: import 与字段**

- import 区追加：
  - `import { TurnOrderQueue } from '../ui/TurnOrderQueue'`
  - `import { buildTurnOrderQueue } from '../core/battle/queue'`
- 字段区（`operationButtons` 附近）追加：
  - `private turnOrderQueue: TurnOrderQueue | null = null`

- [ ] **Step 2: createLayers 实例化 + shutdown 销毁**

在 `createLayers()` 中 `this.operationButtons = new OperationButtons(...)` 之后追加：

```ts
    // 行动顺序条（底部通栏：当前回合行动顺序 + 黄框高亮/灰态；纯显示不拦截地图交互）
    this.turnOrderQueue = new TurnOrderQueue(this)
```

在 `this.events.once('shutdown', ...)` 回调里追加 `this.turnOrderQueue?.destroy()`（与 bgmControls/operationButtons 并列）。

- [ ] **Step 3: 抽 `syncViews()` 并替换刷新入口**

把 `refreshViews()` 改为：

```ts
  /** 一次性同步全部战场视图（单位/高亮/行动顺序条/log 结算）；玩家与敌方 AI 行动后共用 */
  private syncViews(): void {
    this.drawUnits()
    this.drawOverlay()
    this.turnOrderQueue?.render(this.state)
    this.updateLogAndResult()
  }

  private refreshViews(): void {
    this.syncViews()
    this.stepEnemyAi().catch((err) => console.error('stepEnemyAi failed:', err))
  }
```

在 `stepEnemyAi()` 的 while 循环末尾，把这三行：

```ts
        this.drawUnits()
        this.drawOverlay()
        this.updateLogAndResult()
```

替换为 `this.syncViews()`（敌方每步行动后队列也即时刷新）。

- [ ] **Step 4: 结算时隐藏行动顺序条**

在 `updateLogAndResult()` 中 `this.operationButtons?.setVisible(!terminal)` 之后追加：

```ts
    this.turnOrderQueue?.setVisible(!terminal)
```

- [ ] **Step 5: getDebugState 暴露 turnQueue**

在 `getDebugState()` 返回对象的 `order: state.order,` 之后追加：

```ts
      turnQueue: buildTurnOrderQueue(state),
```

- [ ] **Step 6: 验证 + 提交**

Run: `pnpm typecheck`（Expected: 无错误）
Run: `pnpm test`（Expected: core 单测全绿，含 Task 1 的 queue 用例）

```bash
git add src/scenes/BattleScene.ts
git commit -m "feat: 战斗接线行动顺序条（syncViews 统一刷新玩家/敌方回合 + 结算隐藏 + debug 暴露 turnQueue）"
```

---

### Task 5: e2e 断言（队列一致性 / 灰态高亮 / 回合重排 / 输入不冲突）

**Files:**
- Modify: `src/e2e/battle.spec.ts`（`DebugGameState` 接口加 `turnQueue`；追加 4 个 test）

**Interfaces:**
- Consumes: `getState().turnQueue`（Task 4）、`getState().order` / `.currentUnitId` / `.units[].hasActed` / `.camera`（已有）、`SKIP` 常量（已有）。

- [ ] **Step 1: 接口补 `turnQueue`**

在 `src/e2e/battle.spec.ts` 的 `DebugGameState` 接口里，`units?: UnitState[]` 之后追加：

```ts
  turnQueue?: { unitId: string; side: string; defId: string; hasActed: boolean }[]
```

- [ ] **Step 2: 追加 4 个测试**

在文件末尾追加（复用文件顶部已有的 `SKIP`、`getState`、`waitBattleReady`、`setAnimationSpeed`、`startBattle`）：

```ts
test('行动顺序条：队列 = state.order 派生，首格=当前单位，开局全员未行动', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  const s = await getState(page)
  const q = s.turnQueue!
  expect(q.map((e) => e.unitId)).toEqual(s.order)
  expect(q[0]!.unitId).toBe(s.currentUnitId) // 骑兵 speed9 最先行动
  expect(q.filter((e) => e.side === 'player')).toHaveLength(4)
  expect(q.every((e) => !e.hasActed)).toBe(true)
  await page.screenshot({ path: 'screenshots/battle-turn-order-bar.png' })
})

test('行动顺序条：行动后该格灰掉（hasActed），高亮移到下一单位', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 }) // 同速 → order=[p0,p1,e0]，p0 先动
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const reach = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach.screen.x, reach.screen.y) // p0 移动即行动
  s = await getState(page)
  const q = s.turnQueue!
  expect(q.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0']) // 本回合 order 不变
  expect(q.find((e) => e.unitId === 'p0')!.hasActed).toBe(true) // 灰掉
  expect(s.currentUnitId).toBe('p1') // 高亮移到下一格
})

test('行动顺序条：整回合结束按剩余部队当前速度重排', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 8 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 7, rows: 3 }) // p0 骑兵 speed9、p1 民兵 speed4、e0 民兵 speed4（同速玩家先行）
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  expect(s.turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0'])
  await page.mouse.click(SKIP.x, SKIP.y) // 跳过 p0
  await page.mouse.click(SKIP.x, SKIP.y) // 跳过 p1 → 轮到 e0（AI 自动行动）
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.turn === 2
  })
  s = await getState(page)
  expect(s.turn).toBe(2)
  expect(s.turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0']) // 按速度重排，骑兵仍居首
  expect(s.turnQueue!.every((e) => !e.hasActed)).toBe(true)
  expect(s.currentUnitId).toBe('p0') // 高亮回到队首
})

test('行动顺序条不拦截地图交互：横条上拖拽平移相机、点击不触发行动', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const cam0 = (await getState(page)).camera!
  const barY = 1080 - 44 // 通栏条中心（BAR_H=88）
  // 在横条上起手拖拽 → 相机仍平移（横条非 interactive）
  await page.mouse.move(960, barY)
  await page.mouse.down()
  await page.mouse.move(1040, barY + 20, { steps: 5 })
  await page.mouse.up()
  const cam1 = (await getState(page)).camera!
  expect(cam1.scrollX).not.toBe(cam0.scrollX)
  expect(cam1.scrollY).not.toBe(cam0.scrollY)
  // 点击横条 → 无移动/选中/行动（底部坐标换算为界外 hex → 自然 no-op）
  const before = await getState(page)
  await page.mouse.click(960, barY)
  const after = await getState(page)
  expect(after.currentUnitId).toBe(before.currentUnitId)
  expect(after.selectedUnitId).toBeNull()
  for (const u of after.units!) expect(u.hasActed).toBe(false)
})
```

- [ ] **Step 3: 跑 e2e 确认通过**

Run: `pnpm test:e2e src/e2e/battle.spec.ts`
Expected: 全部 test 通过（含原有用例——横条不影响既有交互：SKIP 在 (1880,1040) 恰在横条内，但按钮是 interactive、depth 12 高于横条，`hitTestPointer` 仍命中按钮）。

- [ ] **Step 4: 提交**

```bash
git add src/e2e/battle.spec.ts
git commit -m "test: 行动顺序条 e2e（队列一致性/灰态高亮/回合重排/输入不冲突）"
```

---

### Task 6: PRD 同步 + 全量验证

**Files:**
- Modify: `PRD.md`（§15 战斗（MVP）段追加完成项）

- [ ] **Step 1: PRD 同步**

在 `PRD.md` §15「战斗（MVP）」段（`- [x] 切场输入防抖...` 之后）追加：

```markdown
- [x] 行动顺序条（2026-08）：画面底部**全宽通栏条**，按 `state.order` 显示当前回合行动顺序（方块底色=兵种六边形格子同色、中央 gridLabel 大字、当前单位黄框高亮、已行动灰掉；跨回合按剩余部队当前速度自动重排；`src/ui/TurnOrderQueue.ts` 纯显示**不拦截**地图拖拽/滚轮/点击；数据完全派生自 core，视图无重复状态）
```

- [ ] **Step 2: 全量验证**

Run: `pnpm test`（core 单测全绿）
Run: `pnpm typecheck`（无错误）
Run: `pnpm test:e2e`（全套 e2e 通过；横条为全宽底部通栏，原有 SKIP/SURRENDER/BGM 坐标仍在条内但均 interactive，断言不受影响）

- [ ] **Step 3: 提交**

```bash
git add PRD.md
git commit -m "docs: PRD §15 同步行动顺序条完成项"
```

---

## 自审记录

- **Spec 覆盖**：①布局/视觉 → Task 3；②MVC 数据派生 → Task 1；③输入不冲突 → Task 3 非 interactive + Task 5 输入测试；④组件结构/syncViews → Task 4；⑤测试 → Task 1（core）+ Task 5（e2e）；⑥PRD 同步 → Task 6。全部覆盖。
- **占位符检查**：无 TBD/TODO，每个代码步骤都有完整实现。
- **类型一致性**：`TurnOrderEntry` / `buildTurnOrderQueue` 签名在 Task 1 定义，Task 3/4/5 引用一致；`BATTLE_SIDE_COLORS` 在 Task 2 定义，Task 3 引用一致；`TurnOrderQueue.render/setVisible/destroy` 在 Task 3 定义，Task 4 调用一致；`turnQueue` 在 Task 4 暴露、Task 5 断言一致。
