# 战斗操作按钮行 + 等待/防御 + 降逃和 + 模式连接接口 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把战斗底部行动队列行升级为「三段队列 + 两侧功能按钮」的整合交互条，新增等待/防御/降逃和命令与模式连接接口。

**Architecture:** core（`src/core/battle/`）先做三队列重构（`completedQueue`/`normalQueue`/`waitQueue` 替代 `order`），再依次加等待、防御+加成链、降逃和+`BattleResult`，全部纯 TS 可单测；渲染层（`src/ui/`、`src/scenes/BattleScene.ts`）消费新状态渲染三段队列与按钮，`Modal` 做确认/信息弹窗；e2e 用 dev bridge 断言。最后写 `docs/FUTURE-WORK.md` + 同步 PRD。

**Tech Stack:** TypeScript 5（strict）、Phaser 4.2（仅渲染）、Vitest 4（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- core 零 Phaser 依赖；确定性：所有操作走 `CommandLog` + `battleReducer`，禁裸 `Math.random`/`Date.now`。
- 队列命名：`completedQueue` / `normalQueue` / `waitQueue`（不要 `*Order`）。
- `normalQueue` = `effectiveSpeed` 降序（队首=下一个行动）；`waitQueue` = 升序（队首=最慢=下一个行动，正常队列清空后才行动）。
- 队列是排序权威；单位级 `hasActed` 与队列同步维护（行动 → `hasActed=true` + 追加进 `completedQueue`）。
- 每个 core 改动配 Vitest 单测；每轮改动后跑 `pnpm test`；typecheck 只在 commit 前跑一次。
- 渲染层回归以 Playwright 状态断言为准（`window.__game.getState()`），截图仅供人工目检。
- 提交信息清晰；改动前跑 `pnpm test`。
- 每完成一步任务后把 PRD §15/§16 与实现保持一致。

---

### Task 1: core 三队列重构（状态 + 推进 + 视图投影）

**Files:**
- Modify: `src/core/battle/types.ts`
- Modify: `src/core/battle/battleReducer.ts`
- Modify: `src/core/battle/queue.ts`
- Modify: `src/core/battle/battleReducer.test.ts`
- Modify: `src/core/battle/queue.test.ts`

**Interfaces:**
- Consumes: `BattleState`（现含 `order: string[]`）、`compareUnits`/`sortOrder`（battleReducer 内已有）、`UNIT_DEFS`。
- Produces:
  - `BattleState.completedQueue/normalQueue/waitQueue: string[]`（替代 `order`）
  - `buildTurnOrderQueue(state): TurnOrderEntry[]`，其中 `TurnOrderEntry` 增加 `segment: 'done'|'normal'|'wait'`
  - 内部 helper（同文件私有）：`markActed(state, unitId, extra?)`、`nextUnactedId(state)`、`applyTerminal(state)`、`reorderNormal(state)`

- [ ] **Step 1: 改 `types.ts` —— `order` 换三队列**

在 `BattleState` 中删除 `order: string[]`，替换为：

```ts
/** 本回合已完成行动的单位 id（按完成先后追加） */
completedQueue: string[]
/** 正常行动队列（effectiveSpeed 降序；队首=下一个行动） */
normalQueue: string[]
/** 等待队列（effectiveSpeed 升序；正常队列清空后才行动；队首=最慢） */
waitQueue: string[]
```

`createInitialBattleState`（battleReducer.ts 内）同步初始化三队列为空数组。

- [ ] **Step 2: 改 `battleReducer.ts` —— 推进逻辑适配三队列**

新增三个私有 helper，并改写 `advance`：

```ts
/** 扫 normalQueue → waitQueue，返回第一个存活（仍在 units 中）的未行动单位 */
function nextUnactedId(state: BattleState): string | null {
  const alive = new Set(state.units.map((u) => u.id))
  for (const id of state.normalQueue) if (alive.has(id)) return id
  for (const id of state.waitQueue) if (alive.has(id)) return id
  return null
}

/** 单位完成行动：置 hasActed（+extra），从其所在队列移入 completedQueue */
function markActed(state: BattleState, unitId: string, extra?: Partial<BattleUnit>): BattleState {
  const inWait = state.waitQueue.includes(unitId)
  const units = state.units.map((u) => (u.id === unitId ? { ...u, hasActed: true, ...extra } : u))
  return {
    ...state,
    units,
    normalQueue: inWait ? state.normalQueue : state.normalQueue.filter((id) => id !== unitId),
    waitQueue: inWait ? state.waitQueue.filter((id) => id !== unitId) : state.waitQueue,
    completedQueue: state.completedQueue.includes(unitId) ? state.completedQueue : [...state.completedQueue, unitId]
  }
}

/** 判定终态（一方全灭 → 置 phase）；未终态原样返回。Task 4 再加 outcome */
function applyTerminal(state: BattleState): BattleState {
  const playerAlive = state.units.some((u) => u.side === 'player')
  const enemyAlive = state.units.some((u) => u.side === 'enemy')
  if (playerAlive && enemyAlive) return state
  return { ...state, phase: !enemyAlive ? 'won' : 'lost' }
}

/** 中途速度变化后重排 normalQueue：保留当前单位及之前段，之后剔除阵亡按 effectiveSpeed 降序重排 */
function reorderNormal(state: BattleState): string[] {
  const curIdx = state.normalQueue.indexOf(state.currentUnitId ?? '')
  if (curIdx < 0) return state.normalQueue
  const alive = new Set(state.units.map((u) => u.id))
  const prefix = state.normalQueue.slice(0, curIdx + 1)
  const tail = state.normalQueue
    .slice(curIdx + 1)
    .filter((id) => alive.has(id))
    .sort((aId, bId) => {
      const a = state.units.find((u) => u.id === aId) as BattleUnit
      const b = state.units.find((u) => u.id === bId) as BattleUnit
      return compareUnits(a, b)
    })
  return [...prefix, ...tail]
}

function advance(state: BattleState): BattleState {
  const next = nextUnactedId(state)
  if (next) return { ...state, currentUnitId: next, selectedUnitId: null }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false, retaliated: false }))
  const normalQueue = sortOrder(units)
  return {
    ...state,
    turn: state.turn + 1,
    units,
    completedQueue: [],
    normalQueue,
    waitQueue: [],
    currentUnitId: normalQueue[0] ?? null,
    selectedUnitId: null
  }
}
```

改写各动作命令，用 `markActed` 落队并适配 `applyTerminal`：

- `endTurn`：`return advance(markActed(state, unitId))`
- `move`：守卫不变；最后 `const next = markActed(state, unitId, { position: { ...to }, hasMoved: true }); return advance({ ...next, log: [...state.log, \`第${state.turn}回合 ${unitName(state, unit)} 移动到 (${to.q},${to.r})\`] })`
- `attack`：守卫不变；`computeDamage` 后用 `markActed(state, unitId, { position: { ...dest }, hasMoved: true })` 得到 `next`，再 `next = { ...next, units: dealDamage(next.units, target.id, dmg) }`，最后 `return applyTerminal({ ...next, log: [...state.log, ...logs] })`
- `shoot`：`markActed(state, unitId, { hasMoved: true })` 后 `dealDamage`，`applyTerminal`，未终态再 `advance`
- `retaliate`：保持「不落队、置 retaliated」，`dealDamage` 后 `const s = applyTerminal({ ...state, units, log: [...state.log, ...logs] }); if (s.phase !== 'combat') return s; return advance(s)`
- `speedMod`：`order` 改为 `normalQueue`，重排调用 `reorderNormal(next)`；其余逻辑不变
- `init`：`order: order` → `completedQueue: [], normalQueue: order, waitQueue: []`（phase/outcome 的扩展在 Task 4）

- [ ] **Step 3: 更新 `queue.ts` —— 三段投影**

```ts
export interface TurnOrderEntry {
  unitId: string
  side: BattleUnit['side']
  defId: UnitDefId
  hasActed: boolean
  segment: 'done' | 'normal' | 'wait'
}

export function buildTurnOrderQueue(
  state: Pick<BattleState, 'completedQueue' | 'normalQueue' | 'waitQueue' | 'units'>
): TurnOrderEntry[] {
  const byId = new Map(state.units.map((u) => [u.id, u]))
  const order = [...state.completedQueue, ...state.normalQueue, ...state.waitQueue]
  const entries: TurnOrderEntry[] = []
  for (const id of order) {
    const unit = byId.get(id)
    if (!unit) continue
    const segment = state.completedQueue.includes(id) ? 'done' : state.waitQueue.includes(id) ? 'wait' : 'normal'
    entries.push({ unitId: unit.id, side: unit.side, defId: unit.defId, hasActed: unit.hasActed, segment })
  }
  return entries
}
```

- [ ] **Step 4: 更新 `queue.test.ts` + `battleReducer.test.ts`**

`queue.test.ts`：`buildTurnOrderQueue` 参数改为三队列 + units，断言带上 `segment`。例如：

```ts
const q = buildTurnOrderQueue({ completedQueue: ['p1'], normalQueue: ['e0', 'p0'], waitQueue: [], units })
expect(q.map((e) => e.unitId)).toEqual(['p1', 'e0', 'p0'])
expect(q[0]).toEqual({ unitId: 'p1', side: 'player', defId: 'militia', hasActed: true, segment: 'done' })
expect(q[1]!.segment).toBe('normal')
```

`battleReducer.test.ts`：所有 `s.order` → `s.normalQueue`（第 35、56、72、330、337、347、353、359、370-375 行）。新增两条断言：

```ts
test('移动即行动后：单位移入 completedQueue，normalQueue 收缩', () => {
  const store = makeStore()
  const cur = store.getState().currentUnitId!
  store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
  const s = store.getState()
  expect(s.completedQueue).toEqual([cur])
  expect(s.normalQueue).not.toContain(cur)
  expect(s.currentUnitId).toBe(s.normalQueue[0])
})

test('整回合结束：completedQueue 清空、normalQueue 重建、waitQueue 空', () => {
  const store = makeStore()
  const ids = store.getState().normalQueue
  for (const id of ids) store.dispatch('battle/endTurn', { unitId: id })
  const s = store.getState()
  expect(s.turn).toBe(2)
  expect(s.completedQueue).toEqual([])
  expect(s.waitQueue).toEqual([])
  expect(s.normalQueue).toHaveLength(ids.length)
  expect(s.units.every((u) => !u.hasActed)).toBe(true)
})
```

- [ ] **Step 5: 跑测试**

Run: `pnpm test`
Expected: 全部通过（现有测试改名后绿，新增两条也绿）。

- [ ] **Step 6: 提交**

```bash
git add src/core/battle/types.ts src/core/battle/battleReducer.ts src/core/battle/queue.ts src/core/battle/battleReducer.test.ts src/core/battle/queue.test.ts
git commit -m "refactor: 战斗行动队列重构为三队列（completedQueue/normalQueue/waitQueue）+ 三段视图投影"
```

---

### Task 2: 等待队列 `battle/wait` + waitQueue 速度重排

**Files:**
- Modify: `src/core/battle/battleReducer.ts`
- Modify: `src/core/battle/battleReducer.test.ts`

**Interfaces:**
- Consumes: `markActed`/`nextUnactedId`/`advance`/`reorderNormal`（Task 1）、`effectiveSpeed`、`compareUnits`。
- Produces:
  - 命令 `battle/wait { unitId }`
  - `speedMod` 扩展：受影响单位在 waitQueue 时的重排逻辑
  - `reorderWait(state, tailAsc: boolean)` 内部 helper

- [ ] **Step 1: 写失败测试（battleReducer.test.ts 新增 describe「battle/wait 等待队列」）**

测试阵容（模拟用户 ABCXYZ 例子，用 `speed` 覆盖制造 6 个不同速度）：

```ts
const mkWait = () =>
  makeStore({
    grid: { cols: 7, rows: 3 },
    player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
      units: [
        { defId: 'cavalry', count: 8, speed: 9 },   // A p0
        { defId: 'archer', count: 10, speed: 5 },   // B p1
        { defId: 'militia', count: 10, speed: 4 }   // C p2
      ] },
    enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0,
      units: [
        { defId: 'militia', count: 10, speed: 3 },  // X e0
        { defId: 'militia', count: 10, speed: 2 },  // Y e1
        { defId: 'militia', count: 10, speed: 1 }   // Z e2
      ] }
  })
```

```ts
test('等待：当前单位移入 waitQueue 升序、normalQueue 收缩、不置 hasActed', () => {
  const store = mkWait()
  expect(store.getState().normalQueue).toEqual(['p0', 'p1', 'p2', 'e0', 'e1', 'e2'])
  store.dispatch('battle/wait', { unitId: 'p0' })
  let s = store.getState()
  expect(s.waitQueue).toEqual(['p0'])
  expect(s.normalQueue).toEqual(['p1', 'p2', 'e0', 'e1', 'e2'])
  expect(s.currentUnitId).toBe('p1')
  expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(false)
  // B 等待 → 升序插入：B(5) 在 A(9) 前 → [B, A]
  store.dispatch('battle/wait', { unitId: 'p1' })
  s = store.getState()
  expect(s.waitQueue).toEqual(['p1', 'p0'])
  expect(s.normalQueue).toEqual(['p2', 'e0', 'e1', 'e2'])
})

test('用户例子全流程：AB等待→BA、X减速A→AB、Y等待→YAB、Y减速B→YBA', () => {
  const store = mkWait()
  store.dispatch('battle/wait', { unitId: 'p0' })   // A 等待
  store.dispatch('battle/wait', { unitId: 'p1' })   // B 等待
  expect(store.getState().waitQueue).toEqual(['p1', 'p0'])      // B,A
  expect(store.getState().normalQueue).toEqual(['p2', 'e0', 'e1', 'e2'])
  store.dispatch('battle/endTurn', { unitId: 'p2' })            // C 行动
  expect(store.getState().normalQueue).toEqual(['e0', 'e1', 'e2'])
  // X(e0) 行动时减速 A → A(4) 比 B(5) 慢 → wait 段整体升序重排 [A,B]
  store.dispatch('battle/speedMod', { unitId: 'p0', delta: -5 })
  store.dispatch('battle/endTurn', { unitId: 'e0' })
  expect(store.getState().waitQueue).toEqual(['p0', 'p1'])      // A,B
  // Y(e1) 等待 → 升序插入 Y(2) → Y,A,B
  store.dispatch('battle/wait', { unitId: 'e1' })
  expect(store.getState().waitQueue).toEqual(['e1', 'p0', 'p1']) // Y,A,B
  expect(store.getState().normalQueue).toEqual(['e2'])
  // Z(e2) 行动 → normal 空 → wait 段开始，current=Y
  store.dispatch('battle/endTurn', { unitId: 'e2' })
  expect(store.getState().normalQueue).toEqual([])
  expect(store.getState().currentUnitId).toBe('e1')
  // Y 行动时减速 B → B(1) 比 A(4)、Y(2) 都慢 → 保留当前 Y，尾部升序 → [Y,B,A]
  store.dispatch('battle/speedMod', { unitId: 'p1', delta: -4 })
  expect(store.getState().waitQueue).toEqual(['e1', 'p1', 'p0']) // Y,B,A
})

test('已等待单位再行动时不能再次等待（在 waitQueue 的当前单位 wait → no-op）', () => {
  const store = mkWait()
  store.dispatch('battle/wait', { unitId: 'p0' })
  store.dispatch('battle/wait', { unitId: 'p1' })
  store.dispatch('battle/endTurn', { unitId: 'p2' })
  store.dispatch('battle/endTurn', { unitId: 'e0' })
  store.dispatch('battle/wait', { unitId: 'e1' })
  store.dispatch('battle/endTurn', { unitId: 'e2' })
  expect(store.getState().currentUnitId).toBe('e1') // wait 段队首
  store.dispatch('battle/wait', { unitId: 'e1' })   // 已等待过 → no-op
  expect(store.getState().currentUnitId).toBe('e1')
  expect(store.getState().waitQueue).toEqual(['e1', 'p0', 'p1'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test battleReducer.test.ts`
Expected: FAIL（`battle/wait` 未实现 → reducer 默认 no-op）。

- [ ] **Step 3: 实现 `battle/wait` + `speedMod` wait 段重排**

battleReducer.ts 新增：

```ts
/** 重排 waitQueue：保留 prefix（当前单位及之前）不动，之后剔除阵亡按升序（tailAsc=true）重排 */
function reorderWait(state: BattleState, tailAsc: boolean): string[] {
  const curIdx = state.waitQueue.indexOf(state.currentUnitId ?? '')
  const alive = new Set(state.units.map((u) => u.id))
  const tail = (curIdx >= 0 ? state.waitQueue.slice(curIdx + 1) : state.waitQueue).filter((id) => alive.has(id))
  tail.sort((aId, bId) => {
    const a = state.units.find((u) => u.id === aId) as BattleUnit
    const b = state.units.find((u) => u.id === bId) as BattleUnit
    return tailAsc ? compareUnits(b, a) : compareUnits(a, b)
  })
  return curIdx >= 0 ? [...state.waitQueue.slice(0, curIdx + 1), ...tail] : tail
}

/** 等待：当前单位从 normalQueue 移入 waitQueue（升序插入）。已在 waitQueue 则 no-op */
function wait(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || state.phase !== 'combat') return state
  if (state.waitQueue.includes(unitId)) return state
  const waitQueue = [...state.waitQueue, unitId].sort((aId, bId) => {
    const a = state.units.find((u) => u.id === aId) as BattleUnit
    const b = state.units.find((u) => u.id === bId) as BattleUnit
    return compareUnits(b, a) // 升序：慢的在前
  })
  const next = { ...state, normalQueue: state.normalQueue.filter((id) => id !== unitId), waitQueue }
  return advance(next)
}
```

`speedMod` 扩展（替换 Task 1 的版本，`order`→`normalQueue` 之外加 wait 分支）：

```ts
function speedMod(state: BattleState, unitId: string, delta: number): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || state.phase !== 'combat') return state
  const newMod = (unit.speedMod ?? 0) + delta
  const units = state.units.map((u) => (u.id === unitId ? { ...u, speedMod: newMod } : u))
  const next = { ...state, units }
  let order = next.normalQueue
  let waitOrder = next.waitQueue
  if (state.waitQueue.includes(unitId)) {
    // 受影响在 waitQueue：若当前单位也在 waitQueue（等待段正在行动）→ 保留当前，尾部升序；否则整体升序
    waitOrder = reorderWait(next, true)
  } else if (state.normalQueue.includes(unitId)) {
    order = reorderNormal(next)
  }
  const log = [
    ...state.log,
    `第${state.turn}回合 ${unitName(state, unit)} 速度${delta >= 0 ? '+' : ''}${delta}（现 ${effectiveSpeed({ ...unit, speedMod: newMod })}）`
  ]
  return { ...next, normalQueue: order, waitQueue: waitOrder, log }
}
```

reducer 加分支：`case 'battle/wait': return wait(state, (cmd.payload as { unitId: string }).unitId)`

> 注：`compareUnits(b, a)` 反转即升序（慢的排前）。已验证：B(5) vs A(9) → `compareUnits(A, B)` 返回 A 在 B 前（降序）→ 反转后 B 在 A 前（升序）✓。

- [ ] **Step 4: 跑测试**

Run: `pnpm test battleReducer.test.ts`
Expected: 三条新测试 + 既有测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/battle/battleReducer.ts src/core/battle/battleReducer.test.ts
git commit -m "feat: battle/wait 等待队列（升序插入 + wait 段速度重排 + 不可二次等待）"
```

---

### Task 3: 防御 `battle/defend` + 攻防加成链

**Files:**
- Modify: `src/core/battle/types.ts`
- Modify: `src/core/battle/battleReducer.ts`
- Modify: `src/core/battle/damage.ts`
- Modify: `src/core/battle/battleReducer.test.ts`
- Modify: `src/core/battle/damage.test.ts`（若有；无则新建）

**Interfaces:**
- Consumes: `markActed`/`advance`（Task 1）、`computeActualAttack`/`computeActualDefense`/`computeDamage`（damage.ts）。
- Produces:
  - `BattleUnit.mods?: { atk?: number; def?: number; atkPct?: number; defPct?: number }`
  - `BattleUnit.defending?: boolean`
  - `DEFEND_BONUS = 2`（damage.ts 常量）
  - `computeActualAttack(defId, atkBonus, mods?)` / `computeActualDefense(defId, defBonus, mods?, defending?)`
  - 命令 `battle/defend { unitId }`

- [ ] **Step 1: 写失败测试**

```ts
describe('battle/defend + 加成链', () => {
  test('defend：defending=true、hasActed=true、落 completedQueue、log', () => {
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 10 }] }
    })
    store.dispatch('battle/defend', { unitId: 'p0' })
    const s = store.getState()
    const p0 = s.units.find((u) => u.id === 'p0')!
    expect(p0.defending).toBe(true)
    expect(p0.hasActed).toBe(true)
    expect(s.completedQueue).toEqual(['p0'])
    expect(s.currentUnitId).toBe('e0') // 同速（民兵4=刀兵4）玩家先行，p0 已行动 → e0 当前
  })

  test('defend +2 防御减少所受伤害；下次行动后过期', () => {
    // p0 民兵防4 defend → 防4+2=6；e0 刀兵攻6 → 差0 → ×1.0 → 伤 round(10×4×1.0)=40
    // 未 defend 时差+2 → ×1.1 → 44
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 10 }] }
    })
    store.dispatch('battle/defend', { unitId: 'p0' })
    store.dispatch('battle/attack', { unitId: 'e0', targetId: 'p0', to: { q: 1, r: 0 } }) // e0(1,0) 原地攻击贴身的 p0
    let s = store.getState()
    expect(s.units.find((u) => u.id === 'p0')!.hpLeft).toBe(60) // 100 - 40（+2 防减伤）
    // p0 未反击、主攻不自动推进 → 手动 battle/advance 开新回合
    store.dispatch('battle/advance')
    s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.units.find((u) => u.id === 'p0')!.defending).toBe(true) // 跨回合保留
    expect(s.currentUnitId).toBe('p0') // 同速玩家先行
    store.dispatch('battle/endTurn', { unitId: 'p0' }) // p0 下次行动 → defending 清除
    expect(store.getState().units.find((u) => u.id === 'p0')!.defending).toBe(false)
  })

  test('加成链：mods 点数 + 百分比 + defending +2', () => {
    expect(computeActualDefense('militia', 0, undefined, true)).toBe(6)      // 4+0+0+2
    expect(computeActualDefense('militia', 0, { def: 3 }, true)).toBe(9)     // (4+3+2)×1
    expect(computeActualDefense('militia', 0, { def: 3, defPct: 0.5 }, true)).toBe(13.5) // (4+3+2)×1.5
    expect(computeActualDefense('militia', 0, { defPct: 0.1 }, false)).toBe(4.4)
    expect(computeActualAttack('swordsman', 6, { atk: 2, atkPct: 0.1 })).toBe(15.4) // (6+6+2)×1.1
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test battleReducer.test.ts`
Expected: FAIL（`battle/defend` 未实现、`computeActualDefense` 签名未变）。

- [ ] **Step 3: 实现**

`types.ts`：`BattleUnit` 加 `mods?: { atk?: number; def?: number; atkPct?: number; defPct?: number }`、`defending?: boolean`。

`damage.ts`：

```ts
export const DEFEND_BONUS = 2

export function computeActualAttack(defId: UnitDefId, atkBonus: number, mods?: { atk?: number; atkPct?: number }): number {
  const base = UNIT_DEFS[defId].attack + atkBonus + (mods?.atk ?? 0)
  return base * (1 + (mods?.atkPct ?? 0))
}

export function computeActualDefense(
  defId: UnitDefId,
  defBonus: number,
  mods?: { def?: number; defPct?: number },
  defending = false
): number {
  const base = UNIT_DEFS[defId].defense + defBonus + (mods?.def ?? 0) + (defending ? DEFEND_BONUS : 0)
  return base * (1 + (mods?.defPct ?? 0))
}
```

`computeDamage` 内改为 `computeActualAttack(attacker.defId, atkBonus, attacker.mods)` 与 `computeActualDefense(target.defId, defBonus, target.mods, target.defending)`。

`battleReducer.ts`：

```ts
function defend(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || state.phase !== 'combat') return state
  const next = markActed(state, unitId, { defending: true })
  const log = [...state.log, `第${state.turn}回合 ${unitName(state, unit)} 原地防御（防御 +${DEFEND_BONUS}）`]
  return advance({ ...next, log })
}
```

`markActed` 里对 move/attack/shoot/endTurn 的行动单位**清除 defending**（"直到下次行动"）：在 `markActed` 的 map 里加 `defending: false`？不行——defend 命令自己靠 `extra` 置 true。改为：`markActed` 默认把 `defending` 清掉，`extra` 可覆盖：

```ts
const units = state.units.map((u) =>
  u.id === unitId ? { ...u, hasActed: true, defending: false, ...extra } : u
)
```

这样 defend 传 `extra: { defending: true }` 覆盖回来；其他行动自然清空。`wait` 不调用 `markActed`，故不清。

reducer 加：`case 'battle/defend': return defend(state, (cmd.payload as { unitId: string }).unitId)`

- [ ] **Step 4: 跑测试**

Run: `pnpm test battleReducer.test.ts`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/battle/types.ts src/core/battle/battleReducer.ts src/core/battle/damage.ts src/core/battle/battleReducer.test.ts
git commit -m "feat: battle/defend 防御指令（+2 防、下次行动过期）+ 攻防加成链 mods"
```

---

### Task 4: 降/逃/和 + BattleResult + 保释金

**Files:**
- Modify: `src/core/battle/types.ts`
- Modify: `src/core/battle/battleReducer.ts`
- Create: `src/core/battle/result.ts`
- Create: `src/core/battle/result.test.ts`

**Interfaces:**
- Consumes: `markActed`/`applyTerminal`（Task 1）、`UNIT_DEFS`、`BattleState`。
- Produces:
  - `type BattleOutcome = 'won' | 'lost' | 'surrendered' | 'fled' | 'negotiated'`
  - `interface BattleEnterParams { playerGold: number; opponentKind: 'faction' | 'wild' }`
  - `interface BattleResult { outcome; remainingTroops; expGained; goldSettlement; generalCaptured }`
  - `BattleState.enter?: BattleEnterParams`、`BattleState.outcome: BattleOutcome | null`
  - `phase` 扩展为 `'combat' | 'won' | 'lost' | 'fled' | 'negotiated'`
  - `BAIL_RATIO = 1.5`、`computeBail(state): number`、`buildBattleResult(state): BattleResult`（result.ts）
  - 命令 `battle/flee`、`battle/negotiate`；`battle/surrender` 补 `outcome`

- [ ] **Step 1: 写失败测试（result.test.ts + battleReducer.test.ts 扩展）**

```ts
// result.test.ts
import { describe, expect, test } from 'vitest'
import { buildBattleResult, computeBail } from './result'
import type { BattleState } from './types'

function mkState(over: Partial<BattleState>): BattleState {
  return {
    grid: { cols: 3, rows: 3 }, obstacles: [],
    units: [
      { id: 'p0', side: 'player', defId: 'militia', count: 30, position: { q: 0, r: 0 }, size: 1, hpLeft: 300, maxHp: 300, hasActed: false, hasMoved: false, retaliated: false },
      { id: 'e0', side: 'enemy', defId: 'cavalry', count: 8, position: { q: 1, r: 0 }, size: 2, hpLeft: 240, maxHp: 240, hasActed: false, hasMoved: false, retaliated: false }
    ],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, completedQueue: [], normalQueue: ['p0', 'e0'], waitQueue: [], currentUnitId: 'p0',
    selectedUnitId: null, phase: 'combat', outcome: null, enter: { playerGold: 10000, opponentKind: 'faction' }, log: [],
    ...over
  }
}

describe('computeBail', () => {
  test('150% 剩余部队金币价值：民兵30×50 + 骑兵8×200 = 1500+1600=3100 → 4650', () => {
    expect(computeBail(mkState({}))).toBe(4650)
  })
  test('阵亡单位不计入（units 只剩存活）', () => {
    expect(computeBail(mkState({ units: mkState({}).units.filter((u) => u.id === 'p0') }))).toBe(Math.round(30 * 50 * 1.5))
  })
})

describe('buildBattleResult', () => {
  test('议和：outcome=negotiated、goldSettlement=-bail、部队保留、generalCaptured=false', () => {
    const r = buildBattleResult(mkState({ phase: 'negotiated', outcome: 'negotiated' }))
    expect(r.outcome).toBe('negotiated')
    expect(r.goldSettlement).toBe(-4650)
    expect(r.remainingTroops).toHaveLength(2)
    expect(r.generalCaptured).toBe(false)
    expect(r.expGained).toBe(0)
  })
  test('投降：outcome=surrendered、部队清零、generalCaptured=true', () => {
    const r = buildBattleResult(mkState({ phase: 'lost', outcome: 'surrendered' }))
    expect(r.outcome).toBe('surrendered')
    expect(r.remainingTroops).toEqual([])
    expect(r.generalCaptured).toBe(true)
  })
  test('逃跑：outcome=fled、部队清零、generalCaptured=false、goldSettlement=0', () => {
    const r = buildBattleResult(mkState({ phase: 'fled', outcome: 'fled' }))
    expect(r.outcome).toBe('fled')
    expect(r.remainingTroops).toEqual([])
    expect(r.generalCaptured).toBe(false)
    expect(r.goldSettlement).toBe(0)
  })
  test('自然战败：generalCaptured=null（探索层决定 30% 逃跑）', () => {
    expect(buildBattleResult(mkState({ phase: 'lost', outcome: 'lost' })).generalCaptured).toBeNull()
  })
})
```

battleReducer.test.ts 新增：

```ts
describe('降/逃/和', () => {
  const mkEnter = (enter?: Partial<{ playerGold: number; opponentKind: 'faction' | 'wild' }>) =>
    makeStore({ enter: { playerGold: 10000, opponentKind: 'faction', ...enter } })

  test('surrender：phase=lost、outcome=surrendered', () => {
    const store = mkEnter()
    store.dispatch('battle/surrender')
    const s = store.getState()
    expect(s.phase).toBe('lost')
    expect(s.outcome).toBe('surrendered')
  })
  test('flee：phase=fled、outcome=fled', () => {
    const store = mkEnter()
    store.dispatch('battle/flee')
    const s = store.getState()
    expect(s.phase).toBe('fled')
    expect(s.outcome).toBe('fled')
  })
  test('negotiate：金钱足够且非野怪 → phase=negotiated', () => {
    const store = mkEnter()
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('negotiated')
  })
  test('negotiate：金钱不足 → 拒绝', () => {
    const store = mkEnter({ playerGold: 0 })
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('combat')
  })
  test('negotiate：野怪不可议和 → 拒绝', () => {
    const store = mkEnter({ opponentKind: 'wild' })
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('combat')
  })
})
```

`makeStore` 需支持 `enter`：`makeStore(opts?: { ...; enter?: { playerGold: number; opponentKind: 'faction' | 'wild' } })`，dispatch `battle/init` 时透传 `enter`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test battleReducer.test.ts result.test.ts`
Expected: FAIL（类型/函数不存在）。

- [ ] **Step 3: 实现**

`types.ts`：

```ts
export type Phase = 'combat' | 'won' | 'lost' | 'fled' | 'negotiated'
export type BattleOutcome = 'won' | 'lost' | 'surrendered' | 'fled' | 'negotiated'
export interface BattleEnterParams { playerGold: number; opponentKind: 'faction' | 'wild' }
export interface BattleResult {
  outcome: BattleOutcome
  remainingTroops: { defId: UnitDefId; count: number }[]
  expGained: number
  goldSettlement: number
  generalCaptured: boolean | null
}
```

`BattleState`：`phase: Phase`、`outcome: BattleOutcome | null`、`enter?: BattleEnterParams`。`createInitialBattleState` 加 `outcome: null`。

`result.ts`：

```ts
import { UNIT_DEFS } from '../../data/units'
import type { BattleResult, BattleState } from './types'

export const BAIL_RATIO = 1.5

/** 保释金 = 剩余部队金币价值 × BAIL_RATIO（round） */
export function computeBail(state: BattleState): number {
  const value = state.units.reduce((sum, u) => sum + u.count * UNIT_DEFS[u.defId].cost.gold, 0)
  return Math.round(value * BAIL_RATIO)
}

export function buildBattleResult(state: BattleState): BattleResult {
  const outcome = state.outcome ?? 'lost'
  const zeroed = outcome === 'surrendered' || outcome === 'fled'
  return {
    outcome,
    remainingTroops: zeroed ? [] : state.units.map((u) => ({ defId: u.defId, count: u.count })),
    expGained: 0, // 经验系统将来填（仅战胜）
    goldSettlement: outcome === 'negotiated' ? -computeBail(state) : 0,
    generalCaptured: outcome === 'surrendered' ? true : outcome === 'fled' || outcome === 'negotiated' ? false : null
  }
}
```

`battleReducer.ts`：`init` 扩展 payload（`playerGold?: number`、`opponentKind?: 'faction' | 'wild'`），写入 `state.enter`；新增：

```ts
function flee(state: BattleState): BattleState {
  return { ...state, phase: 'fled', outcome: 'fled', log: [...state.log, '逃跑：弃军返回驻城'] }
}
function negotiate(state: BattleState): BattleState {
  const enter = state.enter
  if (!enter || enter.opponentKind === 'wild') return state
  const bail = computeBail(state)
  if (enter.playerGold < bail) return state
  return { ...state, phase: 'negotiated', outcome: 'negotiated', log: [...state.log, `议和：支付 ${bail} 金钱，保留部队`] }
}
```

`surrender` 分支改为：`return { ...state, phase: 'lost', outcome: 'surrendered', log: [...state.log, '投降'] }`。
reducer 加：`case 'battle/flee': return flee(state)`、`case 'battle/negotiate': return negotiate(state)`。

扩展 Task 1 的 `applyTerminal`（自然胜/败也写 outcome）：

```ts
function applyTerminal(state: BattleState): BattleState {
  const playerAlive = state.units.some((u) => u.side === 'player')
  const enemyAlive = state.units.some((u) => u.side === 'enemy')
  if (playerAlive && enemyAlive) return state
  const won = !enemyAlive
  return { ...state, phase: won ? 'won' : 'lost', outcome: won ? 'won' : 'lost' }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test`
Expected: 全绿（含既有）。

- [ ] **Step 5: 提交**

```bash
git add src/core/battle/types.ts src/core/battle/battleReducer.ts src/core/battle/result.ts src/core/battle/result.test.ts src/core/battle/battleReducer.test.ts
git commit -m "feat: 降/逃/和 命令 + BattleResult/computeBail + 模式连接接口类型"
```

---

### Task 5: 渲染层 —— 三段队列 + 功能按钮 + 弹窗 + 快捷键

**Files:**
- Modify: `src/ui/TurnOrderQueue.ts`（三段渲染 + 预留两侧按钮区）
- Create: `src/ui/BattleActionButtons.ts`
- Create: `src/ui/Modal.ts`
- Modify: `src/scenes/BattleScene.ts`（接线、快捷键、移除 OperationButtons、getBattleResult、debug state）
- Modify: `src/dev/debug.ts`（bridge 接口 + `getBattleResult`）
- Modify: `src/scenes/MainMenuScene.ts`（无改动，确认不引用 OperationButtons）
- 删除：`src/ui/OperationButtons.ts`

**Interfaces:**
- Consumes: `buildTurnOrderQueue`（Task 1）、`computeBail`（Task 4）、`effectiveSpeed`、`battleReducer` 各命令、`makeButton`、`css`/`lighten`/`BATTLE_SIDE_COLORS`。
- Produces:
  - `Modal.openConfirm(scene, { title, message, confirmLabel?, cancelLabel? }): Promise<boolean>`
  - `Modal.openInfo(scene, { title, message, closeLabel? }): Promise<void>`
  - `class BattleActionButtons { constructor(scene, cb); render(state, canAct); getLeftWidth(); getRightWidth(); setVisible(v); destroy() }`
  - `BattleScene.getBattleResult(): BattleResult`
  - debug state：`normalQueue/waitQueue/completedQueue`、`turnQueue`（含 segment）、`modal`、`battleResult`（终态时）

**验证方式：** 本任务为渲染层，用 `pnpm typecheck` + `pnpm build` + 人工 `pnpm dev` 冒烟；行为断言交给 Task 6 e2e。

- [ ] **Step 1: `Modal.ts` —— 通用弹窗**

```ts
import Phaser from 'phaser'
import { makeButton } from './button'
import { css, COLORS } from './theme'

export interface ModalOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  closeLabel?: string
}

/**
 * 通用弹窗（渲染层）：半透明全屏遮罩（interactive，挡住下方地图输入——BattleScene 的
 * pointerdown/up 用 hitTestPointer 过滤 UI，遮罩在指针下即被过滤）+ 居中面板 + 按钮。
 * 返回 Promise：确认/关闭 → resolve；遮罩外点击 → resolve(false)（openConfirm）。
 */
export function openModal(scene: Phaser.Scene, opts: ModalOptions): Promise<boolean | void> {
  return new Promise((resolve) => {
    const cam = scene.cameras.main
    const cx = cam.width / 2
    const cy = cam.height / 2
    const created: Phaser.GameObjects.GameObject[] = []
    const overlay = scene.add
      .rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.55)
      .setDepth(30)
      .setScrollFactor(0)
      .setInteractive()
    created.push(overlay)
    const panel = scene.add
      .rectangle(cx, cy, 460, 240, COLORS.nightInk, 0.96)
      .setStrokeStyle(2, COLORS.gilt, 1)
      .setDepth(31)
      .setScrollFactor(0)
    created.push(panel)
    const title = scene.add
      .text(cx, cy - 70, opts.title, { fontFamily: 'sans-serif', fontSize: '24px', color: css(COLORS.parchment), align: 'center' })
      .setOrigin(0.5)
      .setDepth(32)
      .setScrollFactor(0)
    created.push(title)
    const message = scene.add
      .text(cx, cy - 10, opts.message, { fontFamily: 'sans-serif', fontSize: '18px', color: css(COLORS.parchment), align: 'center', wordWrap: { width: 420 } })
      .setOrigin(0.5)
      .setDepth(32)
      .setScrollFactor(0)
    created.push(message)
    const close = (result: boolean | void): void => {
      for (const o of created) o.destroy()
      resolve(result)
    }
    if (opts.confirmLabel !== undefined) {
      const confirm = makeButton(scene, cx + 50, cy + 80, opts.confirmLabel ?? '确定', () => close(true), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      const cancel = makeButton(scene, cx - 50, cy + 80, opts.cancelLabel ?? '取消', () => close(false), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      created.push(confirm, cancel)
      overlay.on('pointerup', () => close(false))
    } else {
      const btn = makeButton(scene, cx, cy + 80, opts.closeLabel ?? '关闭', () => close(), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      created.push(btn)
      overlay.on('pointerup', () => close())
    }
  })
}

export const openConfirm = (scene: Phaser.Scene, o: { title: string; message: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> =>
  openModal(scene, o) as Promise<boolean>
export const openInfo = (scene: Phaser.Scene, o: { title: string; message: string; closeLabel?: string }): Promise<void> =>
  openModal(scene, o) as Promise<void>
```

> 注意：`btn` 闭包变量在两种分支都赋值；confirm/cancel 按钮用 `pointerdown`（与 makeButton 一致），overlay 用 `pointerup` 防误触。`openModal` 返回类型 `Promise<boolean | void>`，两个包装函数收窄。

- [ ] **Step 2: `TurnOrderQueue.ts` —— 三段渲染 + 两侧预留**

构造函数签名改为 `constructor(scene, options: { leftW: number; rightW: number })`，存 `this.leftW/rightW`。`render(state)` 里：
- 队列 `startX = leftW + (cam.width - leftW - rightW) / 2 - totalW / 2`（在两侧按钮区之间水平居中）。
- 方块绘制按 `segment`：
  - 底色：`this.squares.fillStyle(BATTLE_SIDE_COLORS[e.side], e.segment === 'wait' ? 0.55 : 1)`（等待段略暗）；
  - `done` 段再叠加 `this.squares.fillStyle(0x000000, 0.55); fillRect(...)`（灰掉，现有逻辑）；
- 当前单位黄框高亮（`e.unitId === state.currentUnitId`，lineStyle 3, 0xffcc33）逻辑不变，跨段有效；其余细黑描边。
- 方块循环改为 `entries.forEach((e) => ...)`，用 `e.segment` 分支。

`getLeftWidth/getRightWidth` 由 BattleActionButtons 提供，BattleScene 构造 TurnOrderQueue 时传入。

- [ ] **Step 3: `BattleActionButtons.ts` —— 两侧按钮组**

```ts
import Phaser from 'phaser'
import { computeBail } from '../core/battle/result'
import type { BattleState } from '../core/battle/types'

export interface BattleActionButtonsCallbacks {
  onSurrender(): void
  onFlee(): void
  onNegotiate(): void
  onSkill(): void
  onWait(): void
  onDefend(): void
}

const BTN_W = 46
const BTN_H = 30
const GAP = 6
const PAD = 12

/**
 * 战斗底部行动条两侧按钮组（渲染层）：左=⚙/降/逃/和、右=技/候/守。
 * 布局：左组从左缘排开，右组贴右缘；中间留白给 TurnOrderQueue（getLeftWidth/getRightWidth 提供）。
 * disabled 用 setAlpha(0.4)+灰字表达（点击回调仍触发，场景侧守卫 canAct 兜底）。
 * ⚙ 为 Unicode 占位（用户确认），将来换图标。
 */
export class BattleActionButtons {
  private readonly left: Phaser.GameObjects.Text[] = []   // ⚙ / 降 / 逃 / 和
  private readonly right: Phaser.GameObjects.Text[] = []  // 技 / 候 / 守
  private readonly tooltip: Phaser.GameObjects.Text
  private enabled: boolean[] = []

  constructor(private readonly scene: Phaser.Scene, private readonly cb: BattleActionButtonsCallbacks) {
    this.tooltip = scene.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)' })
      .setDepth(15)
      .setScrollFactor(0)
      .setVisible(false)
    const mkBtn = (label: string, onClick: () => void): Phaser.GameObjects.Text =>
      scene.add
        .text(0, 0, label, { fontFamily: 'sans-serif', fontSize: '16px', color: '#ffffff', backgroundColor: '#33415c', fixedWidth: BTN_W, align: 'center' })
        .setOrigin(0, 0.5)
        .setPadding(0, 8)
        .setDepth(12)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onClick())
    const leftSpecs = [
      { label: '⚙', onClick: () => {} },                                   // 设置（占位，禁用）
      { label: '降', onClick: () => this.cb.onSurrender() },
      { label: '逃', onClick: () => this.cb.onFlee() },
      { label: '和', onClick: () => this.cb.onNegotiate() }
    ]
    const rightSpecs = [
      { label: '技', onClick: () => this.cb.onSkill() },
      { label: '候', onClick: () => this.cb.onWait() },
      { label: '守', onClick: () => this.cb.onDefend() }
    ]
    leftSpecs.forEach((s) => this.left.push(mkBtn(s.label, s.onClick)))
    rightSpecs.forEach((s) => this.right.push(mkBtn(s.label, s.onClick)))
    // 降/逃/和 hover 提示
    const tooltips: Record<string, string> = { 降: '投降', 逃: '逃跑', 和: '议和' }
    for (const b of [...this.left.slice(1), ...this.right]) {
      b.on('pointerover', () => {
        const tip = tooltips[b.text]
        if (tip && this.enabled[this.all().indexOf(b)] !== false) {
          this.tooltip.setText(tip).setPosition(b.x + b.width / 2, this.barY() - BTN_H - 4).setVisible(true)
        }
      })
      b.on('pointerout', () => this.tooltip.setVisible(false))
    }
    this.reposition()
    scene.scale.on('resize', () => this.reposition())
  }

  private barY(): number {
    return this.scene.cameras.main.height - 44
  }

  /** 布局：左组从左缘、右组贴右缘排开，y=条中心；构造与 resize 都调用 */
  private reposition(): void {
    const y = this.barY()
    const rightW = this.getRightWidth()
    for (let i = 0; i < this.left.length; i++) this.left[i]!.setPosition(PAD + i * (BTN_W + GAP), y)
    for (let i = 0; i < this.right.length; i++) {
      const x = this.scene.cameras.main.width - rightW + PAD + i * (BTN_W + GAP)
      this.right[i]!.setPosition(x, y)
    }
  }

  private all(): Phaser.GameObjects.Text[] {
    return [...this.left, ...this.right]
  }

  /** 状态变化时调用：刷新各按钮可用性（议和=金足且非野怪；候=当前未等待） */
  render(state: BattleState, canAct: boolean): void {
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const notWaited = current ? !state.waitQueue.includes(current.id) : false
    const enter = state.enter
    const affordable = enter ? enter.playerGold >= computeBail(state) && enter.opponentKind !== 'wild' : false
    this.enabled = [false, canAct, canAct, canAct && affordable, canAct, canAct && notWaited, canAct]
    this.all().forEach((b, i) => {
      const on = this.enabled[i] === true
      b.setAlpha(on ? 1 : 0.4)
      b.setStyle({ color: on ? '#ffffff' : '#8a8f98' })
    })
  }

  getLeftWidth(): number {
    return PAD * 2 + this.left.length * BTN_W + (this.left.length - 1) * GAP
  }
  getRightWidth(): number {
    return PAD * 2 + this.right.length * BTN_W + (this.right.length - 1) * GAP
  }
  setVisible(v: boolean): void {
    for (const b of this.all()) b.setVisible(v)
    this.tooltip.setVisible(false)
  }
  destroy(): void {
    this.scene.scale.off('resize', this.reposition)
    for (const b of this.all()) b.destroy()
    this.tooltip.destroy()
  }
}
```

> 说明：`mkBtn` 先把按钮建在 (0,0)，push 完后 `reposition()` 统一排 x/y；resize 时 `reposition()` 重贴。disabled 用 `setAlpha(0.4)`+灰字；点击回调仍触发，场景侧 `canPlayerAct()` 兜底。`⚙` 为 Unicode 占位（用户确认）。

- [ ] **Step 4: `BattleScene.ts` 接线**

- `create()` 中 `battle/init` dispatch 加 `playerGold: 10000, opponentKind: 'faction'`（战斗测试注入）。
- `startBattle(player, enemy, grid)` 的 init dispatch 同样加 `playerGold: 10000, opponentKind: 'faction'`。
- 替换 `OperationButtons` 构造为：

```ts
this.actionButtons = new BattleActionButtons(this, {
  onSurrender: () => void this.confirmEnd('surrendered'),
  onFlee: () => void this.confirmEnd('fled'),
  onNegotiate: () => void this.confirmEnd('negotiated'),
  onSkill: () => void this.openSkillPopup(),
  onWait: () => this.tryWait(),
  onDefend: () => this.tryDefend()
})
this.turnOrderQueue = new TurnOrderQueue(this, {
  leftW: this.actionButtons.getLeftWidth(),
  rightW: this.actionButtons.getRightWidth()
})
```

- 新增方法：

```ts
private canPlayerAct(): boolean {
  return !this.busy && this.state.phase === 'combat' && this.currentSide() === 'player'
}

private tryWait(): void {
  if (!this.canPlayerAct()) return
  this.store.dispatch('battle/wait', { unitId: this.state.currentUnitId as string })
  this.refreshViews()
}
private tryDefend(): void {
  if (!this.canPlayerAct()) return
  this.store.dispatch('battle/defend', { unitId: this.state.currentUnitId as string })
  this.refreshViews()
}
private openSkillPopup(): void {
  if (!this.canPlayerAct()) return
  void openInfo(this, { title: '技能', message: '技能系统开发中' })
}
private async confirmEnd(kind: 'surrendered' | 'fled' | 'negotiated'): Promise<void> {
  if (!this.canPlayerAct()) return
  const bail = computeBail(this.state)
  const msg =
    kind === 'surrendered' ? '确定要投降吗？'
    : kind === 'fled' ? '确定要弃军逃跑吗？'
    : `支付 ${bail} 金钱议和，确定吗？`
  const ok = await openConfirm(this, { title: kind === 'negotiated' ? '议和' : '确认', message: msg, confirmLabel: '确定', cancelLabel: '取消' })
  if (!ok || this.state.phase !== 'combat') return
  const cmd = kind === 'surrendered' ? 'battle/surrender' : kind === 'fled' ? 'battle/flee' : 'battle/negotiate'
  this.store.dispatch(cmd)
  this.refreshViews()
}
getBattleResult(): BattleResult {
  return buildBattleResult(this.state)
}
```

- 键盘快捷键（`setupInput` 内追加）：

```ts
this.input.keyboard?.on('keydown-C', () => this.openSkillPopup())
this.input.keyboard?.on('keydown-W', () => this.tryWait())
this.input.keyboard?.on('keydown-D', () => this.tryDefend())
```

- `updateLogAndResult`：结果文字按 `phase` → `won`→胜利、`lost`→战败、`fled`→逃跑、`negotiated`→议和；`this.actionButtons?.setVisible(!terminal)` 与 `turnOrderQueue` 一同隐藏；每帧（或 refreshViews 时）调 `this.actionButtons?.render(this.state, this.canPlayerAct())`。
- `shutdown` 监听加 `this.actionButtons?.destroy()`。
- 删除 `OperationButtons` import 与字段；删除 `surrender()` 私有方法（被 confirmEnd 取代）。

- [ ] **Step 5: `debug.ts` + `getDebugState`**

`DebugBridge` 接口加 `getBattleResult(): string`；bridge 实现 `getBattleResult: () => battle()?.getBattleResult() ? JSON.stringify(battle()!.getBattleResult()) : '{}'`。

`BattleScene.getDebugState()`：`order` 改为 `normalQueue: state.normalQueue`，新增 `waitQueue`、`completedQueue`；`turnQueue` 自动带 `segment`（buildTurnOrderQueue 已含）；新增 `modal: { open: true; title: string; message: string } | null` 与 `battleResult`（终态时）。

BattleScene 加字段 `activeModal: { open: true; title: string; message: string } | null = null`。`confirmEnd` 在 `openConfirm` 前设置：

```ts
this.activeModal = { open: true, title: kind === 'negotiated' ? '议和' : '确认', message: msg }
const ok = await openConfirm(this, { title: this.activeModal.title, message: msg, confirmLabel: '确定', cancelLabel: '取消' })
this.activeModal = null
if (!ok || this.state.phase !== 'combat') return
```

`openSkillPopup` 同样：

```ts
this.activeModal = { open: true, title: '技能', message: '技能系统开发中' }
await openInfo(this, { title: '技能', message: '技能系统开发中' })
this.activeModal = null
```

`getDebugState` 返回 `modal: this.activeModal`；终态时 `battleResult: buildBattleResult(this.state)`。e2e 用 `modal.title/message` 断言 + 固定布局坐标点按钮（见 Task 6 `MODAL`）。

- [ ] **Step 6: typecheck + build 冒烟**

Run: `pnpm typecheck`
Expected: 0 error。

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 7: 提交**

```bash
git add src/ui/Modal.ts src/ui/BattleActionButtons.ts src/ui/TurnOrderQueue.ts src/scenes/BattleScene.ts src/dev/debug.ts
git rm src/ui/OperationButtons.ts
git commit -m "feat: 战斗行动队列行整合（三段队列 + 设置/降逃和/技候守 按钮 + Modal 弹窗 + 快捷键 + BattleResult 暴露）"
```

---

### Task 6: e2e 更新 + 新增用例

**Files:**
- Modify: `src/e2e/battle.spec.ts`
- Modify: `src/e2e/helpers.ts`（如需）

**Interfaces:**
- Consumes: dev bridge `getState()`（含 `normalQueue/waitQueue/completedQueue/turnQueue[].segment/battleResult/modal`）、`startBattle`、`setAnimationSpeed`。
- Produces: 更新后的 `SKIP`/`SURRENDER`/`RETURN` 坐标与降-确认流；新测试用例。

- [ ] **Step 1: 更新受影响的既有用例**

新按钮坐标（1920×1080，条中心 y=1036；左组从左缘排开、右组贴右缘）：
- 左组：⚙(35) 降(87) 逃(139) 和(191)；右组：技(1781) 候(1833) 守(1885)。

```ts
const BAR_Y = 1036
const BTN = { surrender: { x: 87, y: BAR_Y }, flee: { x: 139, y: BAR_Y }, negotiate: { x: 191, y: BAR_Y }, skill: { x: 1781, y: BAR_Y }, wait: { x: 1833, y: BAR_Y }, defend: { x: 1885, y: BAR_Y } }
const MODAL = { confirm: { x: 1010, y: 620 }, cancel: { x: 910, y: 620 }, close: { x: 960, y: 620 } }
```

- 删除 `SKIP`/`SURRENDER` 常量，改用 `BTN`。e2e 里所有 `s.order` 引用 → `s.normalQueue`（`s.order` 已不存在）。
- `行动顺序条` 用例：`q.map(e => e.unitId).toEqual(s.order)` → `toEqual(s.normalQueue)`。
- 现有「撤退后重新进入」用例（line 525）改为【降】+确认流：

```ts
await page.mouse.click(BTN.surrender.x, BTN.surrender.y)
await page.waitForFunction(() => {
  const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
  return st?.modal?.open === true && st?.modal?.title === '确认'
})
await page.mouse.click(MODAL.confirm.x, MODAL.confirm.y)
await page.waitForFunction(() => {
  const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
  return st?.phase === 'lost' && st?.battleResult?.outcome === 'surrendered'
})
```

- `AI 攻击被我方反击打死`、`整回合结束重排`、`默认战斗反复跳过` 等用例里用「守」代替「跳过行动」结束当前行动：`await page.mouse.click(BTN.defend.x, BTN.defend.y)`。

> 模态按钮坐标由 Modal 固定布局决定：面板中心 (960, 540)、确认 (960+50, 540+80)=(1010,620)、取消 (910,620)、关闭 (960,620)。若面板尺寸调整，同步更新。

- [ ] **Step 2: 新增用例**

```ts
test('等待：点【候】→ 单位入 waitQueue（turnQueue 显示 wait 段），再点【候】禁用', async ({ page }) => {
  await gotoBattle(page); await waitBattleReady(page); await setAnimationSpeed(page, 0)
  await page.mouse.click(BTN.wait.x, BTN.wait.y)
  let s = await getState(page)
  expect(s.waitQueue).toHaveLength(1)
  const cur = s.currentUnitId!
  const q = s.turnQueue!
  expect(q.find((e) => e.unitId === cur)!.segment).toBe('wait')
  expect(s.completedQueue).toHaveLength(0) // 等待不算行动
})

test('防御：点【守】→ defending=true + hasActed + 落 completedQueue', async ({ page }) => {
  await gotoBattle(page); await waitBattleReady(page); await setAnimationSpeed(page, 0)
  await page.mouse.click(BTN.defend.x, BTN.defend.y)
  const s = await getState(page)
  const cur = s.currentUnitId!
  const unit = s.units!.find((u) => u.id === cur)!
  expect(unit.defending).toBe(true)
  expect(unit.hasActed).toBe(true)
  expect(s.completedQueue).toContain(cur)
})

test('技能：点【技】→ 弹窗出现（modal.open=true），可关闭', async ({ page }) => {
  await gotoBattle(page); await waitBattleReady(page); await setAnimationSpeed(page, 0)
  await page.mouse.click(BTN.skill.x, BTN.skill.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal?.open === true
  })
  await page.mouse.click(MODAL.close.x, MODAL.close.y) // 关闭按钮（openInfo 用居中 close 按钮）
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal == null
  })
})

test('议和：点【和】→ 弹窗文案含保释金 → 确认 → phase=negotiated + battleResult', async ({ page }) => {
  await gotoBattle(page); await waitBattleReady(page); await setAnimationSpeed(page, 0)
  await page.mouse.click(BTN.negotiate.x, BTN.negotiate.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal?.open === true
  })
  const s = await getState(page)
  expect(s.modal?.message).toContain('支付')
  expect(s.modal?.message).toContain('议和')
  await page.mouse.click(MODAL.confirm.x, MODAL.confirm.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.phase === 'negotiated'
  })
  expect((await getState(page)).battleResult?.outcome).toBe('negotiated')
})
```

> 若 `DebugGameState` 类型缺 `waitQueue/modal/battleResult/defending`，在 battle.spec.ts 顶部接口补字段。

- [ ] **Step 3: 跑 e2e**

Run: `pnpm test:e2e`
Expected: 全部通过。截图存 `screenshots/` 供人工目检。

- [ ] **Step 4: 提交**

```bash
git add src/e2e/battle.spec.ts
git commit -m "test: 战斗 e2e 适配三队列/降确认流 + 新增等待/防御/技能/议和用例"
```

---

### Task 7: 文档 —— FUTURE-WORK.md + PRD 同步

**Files:**
- Create: `docs/FUTURE-WORK.md`
- Modify: `PRD.md`

- [ ] **Step 1: 写 `docs/FUTURE-WORK.md`**

记录今后再做项（保留本次契约）：

```markdown
# 今后再做（未来工作）

> 本文档记录「战斗操作按钮行 + 等待/防御 + 降逃和」设计落地时暂不实现的后续任务。
> 接口契约见 `docs/superpowers/specs/2026-08-14-battle-commands-bar-design.md`（BattleEnterParams /
> BattleResult / 攻防加成链 / BAIL_RATIO=1.5）。

## 探索↔战斗真实接线
- 遭遇战触发（大地图遇敌 → BattleScene 传入 BattleEnterParams：playerGold / opponentKind）
- 结算消费 BattleResult：武将驻城返回 / 被俘（释放|处斩）/ 宝物保留、金钱扣减闭环、经验入库
- 自然战败的 30% 逃跑判定（BattleResult.generalCaptured=null 时探索层决定）

## 技能系统本体
- 主动计略 / 被动技能、技能弹窗填充（当前「技能系统开发中」占位）
- buff/debuff 效果写入 BattleUnit.mods（点数/百分比两层已留空位）

## 设置界面本体
- 底部行【⚙】启用（当前 Unicode 占位 + disabled）
- 音量等设置项（BgmControls/SfxManager 已就绪）

## 经验 / 升级系统
- expGained 消费端（战胜得经验、每级属性增长、每 3 级解锁技能）

## 保释金经济闭环
- 经济系统接线（玩家金钱扣除、AI 阵营接受/拒绝议和）

## 攻防链消费端
- 兵种地形加成、宝物系统（mods 写入）、兵种克制
```

- [ ] **Step 2: 同步 PRD §15/§16**

§15 战斗（MVP）追加完成项：
- `[x]` 行动队列三队列重构（completedQueue/normalQueue/waitQueue）+ 三段连续显示
- `[x]` 等待指令（升序入等待队列、不可二次等待、wait 段速度重排）
- `[x]` 防御指令（+2 防、下次行动过期）+ 攻防加成链（mods 点数/百分比）
- `[x]` 降/逃/和（确认弹窗、无快捷键、BattleResult 产出、议和 150% 保释金）
- `[x]` 行动队列行整合功能按钮（设置⚙占位/降/逃/和/技/候/守）+ Modal 弹窗 + 快捷键 c/w/d

§15 战斗（MVP）「行动顺序条中途重排」条目文字同步更新为 wait 段重排说明。§16 P2「战斗指令（等待/防御）」改为已做并指向 §15；P3「设置界面」备注 ⚙ 占位已就绪。

- [ ] **Step 3: 跑 `pnpm test` + typecheck**

Run: `pnpm test`
Expected: 全绿。

Run: `pnpm typecheck`
Expected: 0 error（commit 前检查）。

- [ ] **Step 4: 提交**

```bash
git add docs/FUTURE-WORK.md PRD.md
git commit -m "docs: FUTURE-WORK 今后再做清单 + PRD §15/§16 同步三队列/等待/防御/降逃和/按钮行"
```
