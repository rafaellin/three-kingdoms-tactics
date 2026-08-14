import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { battleReducer, createInitialBattleState } from '../core/battle/battleReducer'
import { planEnemyAction } from '../core/battle/ai'
import { battleFindPath, battleReachableArea, inBattleGrid } from '../core/battle/pathing'
import { buildTurnOrderQueue } from '../core/battle/queue'
import { canRetaliate } from '../core/battle/battleReducer'
import { occupiedHexes, woundedHp, type BattleArmyConfig, type BattleState, type BattleUnit } from '../core/battle/types'
import { hexDistance, hexKey, hexNeighbor, HexLayout, type Axial, type HexDir } from '../core/hex/HexGrid'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_GRID, BATTLE_OBSTACLES, ENEMY_ARMY, PLAYER_ARMY } from '../data/battleTest'
import { MainMenuScene } from './MainMenuScene'
import { getBgmManager } from '../audio/BgmManager'
import { SfxManager } from '../audio/SfxManager'
import { BgmControls } from '../ui/BgmControls'
import { OperationButtons } from '../ui/OperationButtons'
import { TurnOrderQueue } from '../ui/TurnOrderQueue'
import { fadeAndStart, fadeIn } from '../ui/fade'
import { BATTLE_SIDE_COLORS } from '../ui/theme'

const GRID_COLOR = 0x1a2333
const GRID_LINE = 0x0b0f18
const REACHABLE_FILL = 0x66ccff
const EDGE_HIT_TOLERANCE = 10
/**
 * 战斗场景（渲染层）。职责：读 BattleState 渲染 + 把悬停/点击/按钮转成 battle 命令。
 * 交互（hover 驱动）：
 * - 悬停可达落点边界 → 刀剑光标（点击 = 冲锋/原地近战）；悬停敌军 → 弓/断箭光标（点击 = 远程射击）
 * - 点击己方单位 → select（高亮）；点击可达空格 → move
 * - 角标按钮：跳过行动 / 撤退
 * - 敌方单位由 planEnemyAction 自动行动（异步逐格动画）
 * - 胜负 → 显示结果 + 返回主菜单
 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'Battle'

  private readonly layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })
  private store!: CommandLog<BattleState>
  private gridGraphics!: Phaser.GameObjects.Graphics
  private overlayGraphics!: Phaser.GameObjects.Graphics
  /** 可达范围闪烁层（低 depth，位于单位之下，避免压住单位） */
  private reachGraphics!: Phaser.GameObjects.Graphics
  private unitGraphics!: Phaser.GameObjects.Graphics
  private obstacleGraphics!: Phaser.GameObjects.Graphics
  private hoverGraphics!: Phaser.GameObjects.Graphics
  private unitLabels = new Map<string, Phaser.GameObjects.Text>()
  private unitCounts = new Map<string, Phaser.GameObjects.Text>()
  private infoPanel!: Phaser.GameObjects.Text
  private blinkPhase = 0
  private hover: {
    ghostHex: Axial | null
    swordHex: Axial | null
    /** 刀剑绘制锚点：攻击方体积内与目标相邻的体格（1×2 贴身时为东邻格，而非主体格） */
    swordAdjHex: Axial | null
    cursorKind: 'sword' | 'bow' | 'broken-arrow' | 'move' | 'none'
    swordTargetId: string | null
    blinkId: string | null
  } = { ghostHex: null, swordHex: null, swordAdjHex: null, cursorKind: 'none', swordTargetId: null, blinkId: null }
  private animationMs = 150
  /** 每步行动之间的停顿（ms）；敌方 AI 行动前停顿，让玩家看清上一步结果 */
  private actionGapMs = 700
  private visualPos = new Map<string, Axial>()
  private animQueue: { unitId: string; path: Axial[]; resolve: () => void }[] = []
  private animActive: { unitId: string; path: Axial[]; idx: number; acc: number; resolve: () => void } | null = null
  private moveWaiter: (() => void) | null = null
  private enemyActing = false
  /** 玩家行动结算中（冲锋+攻击+反击停顿+闪白）→ 屏蔽输入，防动画未完就能操作下一单位 */
  private busy = false
  /** 后台 log 缓冲（新增条目输出到 console + 可下载为 .log 文件） */
  private logBuffer: string[] = []
  private logFlushed = 0
  /** 拖拽平移相机（与点击移动/攻击区分：位移 > 阈值视为拖拽） */
  private dragging = false
  private downPos = { x: 0, y: 0 }
  private lastPointer = { x: 0, y: 0 }
  private operationButtons: OperationButtons | null = null
  private turnOrderQueue: TurnOrderQueue | null = null
  /** 受击闪白累计次数（debug / e2e 断言用） */
  private hitFlashCount = 0
  /** 音效（渲染层；移动循环 + 攻击一次性） */
  private sfx: SfxManager | null = null
  private bgmControls: BgmControls | null = null
  private resultText!: Phaser.GameObjects.Text
  private returnButton!: Phaser.GameObjects.Text
  private logText!: Phaser.GameObjects.Text

  constructor() {
    super(BattleScene.KEY)
  }

  create(): void {
    // 场景实例被 scene.start 复用：字段默认值只在构造时初始化一次，必须在此重置跨场景残留的渲染状态
    this.visualPos.clear()
    this.dragging = false
    this.downPos = { x: 0, y: 0 }
    this.lastPointer = { x: 0, y: 0 }
    this.busy = false
    this.enemyActing = false
    this.moveWaiter = null
    this.animActive = null
    this.animQueue.length = 0
    this.logBuffer = []
    this.logFlushed = 0
    this.hitFlashCount = 0
    this.hover = { ghostHex: null, swordHex: null, swordAdjHex: null, cursorKind: 'none', swordTargetId: null, blinkId: null }
    this.blinkPhase = 0
    this.unitLabels.clear()
    this.unitCounts.clear()
    this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
    this.store.dispatch('battle/init', {
      player: PLAYER_ARMY,
      enemy: ENEMY_ARMY,
      grid: { ...BATTLE_GRID, obstacles: BATTLE_OBSTACLES }
    })
    getBgmManager(this).switchToCategory('battle')
    fadeIn(this)
    this.createLayers()
    this.setupBattle()
    this.bgmControls = new BgmControls(this, getBgmManager(this))
    this.sfx = new SfxManager(this)
    this.events.once('shutdown', () => {
      this.bgmControls?.destroy()
      this.operationButtons?.destroy()
      this.turnOrderQueue?.destroy()
    })
  }

  /** 直接以指定阵容/网格开局（e2e 确定性交互测试） */
  startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void {
    this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
    this.store.dispatch('battle/init', { player, enemy, grid })
    this.visualPos.clear()
    this.animQueue.length = 0
    this.animActive = null
    this.enemyActing = false
    this.moveWaiter = null
    this.busy = false
    this.logBuffer = []
    this.logFlushed = 0
    this.sfx?.stopLooped()
    this.drawGrid()
    this.drawObstacles()
    this.setupBattle()
  }

  /** 中途速度修正（dev/e2e 钩子；减速/加速技能将来由此接线） */
  applySpeedMod(unitId: string, delta: number): void {
    this.store.dispatch('battle/speedMod', { unitId, delta })
    this.refreshViews()
  }

  private setupBattle(): void {
    this.centerCamera()
    this.setupInput()
    this.refreshViews()
  }

  update(_time: number, delta: number): void {
    this.blinkPhase += delta * 0.01
    this.updateAnimation(delta)
    // 玩家当前单位行动时，可达范围每帧重绘 → 脉动 alpha（闪烁）标识"这是可移动范围"
    if (this.state.phase === 'combat' && this.currentSide() === 'player') {
      this.drawOverlay()
    }
    if (this.state.phase === 'combat' && (this.hover.ghostHex || this.hover.swordHex || this.hover.blinkId)) {
      this.drawHoverLayer()
    }
  }

  private get state(): BattleState {
    return this.store.getState()
  }

  private createLayers(): void {
    this.gridGraphics = this.add.graphics().setDepth(0)
    this.obstacleGraphics = this.add.graphics().setDepth(1)
    this.reachGraphics = this.add.graphics().setDepth(1)
    this.unitGraphics = this.add.graphics().setDepth(2)
    this.overlayGraphics = this.add.graphics().setDepth(3)
    this.hoverGraphics = this.add.graphics().setDepth(5)
    this.drawGrid()
    this.drawObstacles()
    // 结果 + 返回主菜单（视口固定，scrollFactor 0；整体水平+垂直居中，随相机尺寸动态计算）
    this.resultText = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, '', {
        fontFamily: 'sans-serif',
        fontSize: '48px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setVisible(false)
    this.returnButton = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, '返回主菜单', {
        fontFamily: 'sans-serif',
        fontSize: '24px',
        color: '#ffffff',
        backgroundColor: '#33415c',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(24, 12)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
    this.returnButton.on('pointerdown', () => fadeAndStart(this, MainMenuScene.KEY))
    this.positionResult()
    this.logText = this.add
      .text(24, 24, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#c8d2e0' })
      .setDepth(12)
      .setScrollFactor(0)
    this.infoPanel = this.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#e8eef5', backgroundColor: '#223048', fixedWidth: 260, wordWrap: { width: 250 } })
      .setPadding(10, 8)
      .setDepth(11)
      .setScrollFactor(0)
      .setVisible(false)
    // 战斗操作按钮组（右下角：跳过行动 / 撤退；后续加 待命/防御）——统一定位、resize 重排、结算整体隐藏
    this.operationButtons = new OperationButtons(this, [
      { label: '跳过行动', onClick: () => this.endCurrentTurn() },
      { label: '撤退', onClick: () => this.surrender() }
    ])
    // 行动顺序条（底部通栏：当前回合行动顺序 + 黄框高亮/灰态；纯显示不拦截地图交互）
    this.turnOrderQueue = new TurnOrderQueue(this)
    this.scale.on('resize', () => {
      this.centerCamera()
      this.positionResult()
    })
  }

  private drawGrid(): void {
    this.gridGraphics.clear()
    const { cols, rows } = this.state.grid
    for (let r = 0; r < rows; r++) {
      const qMin = -Math.floor(r / 2)
      for (let q = qMin; q < qMin + cols; q++) {
        const hex = { q, r }
        this.fillHex(this.gridGraphics, hex, GRID_COLOR, 1)
        this.strokeHex(this.gridGraphics, hex, GRID_LINE, 1)
      }
    }
  }

  private drawObstacles(): void {
    this.obstacleGraphics.clear()
    for (const hex of this.state.obstacles) {
      this.fillHex(this.obstacleGraphics, hex, 0x2a3240, 1)
      this.strokeHex(this.obstacleGraphics, hex, GRID_LINE, 2)
    }
  }

  private centerCamera(): void {
    const g = this.state.grid
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let r = 0; r < g.rows; r++) {
      const qMin = -Math.floor(r / 2)
      for (let q = qMin; q < qMin + g.cols; q++) {
        const p = this.layout.hexToPixel({ q, r })
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      }
    }
    this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2)
  }

  /** 画单位（1×2 画两格）、数量文本；含反击打灭单位的幽灵（反击播完前保留显示） */
  private drawUnits(): void {
    this.unitGraphics.clear()
    const seen = new Set<string>()
    const draw = (unit: Pick<BattleUnit, 'id' | 'side' | 'defId' | 'count' | 'size' | 'position'>): void => {
      const pos = this.visualPos.get(unit.id) ?? unit.position
      const def = UNIT_DEFS[unit.defId]
      const footprint = occupiedHexes({ position: pos, size: unit.size })
      for (const hex of footprint) {
        if (!inBattleGrid(this.state, hex)) continue // 防御：1×2 绝不画出边界外
        this.fillHex(this.unitGraphics, hex, BATTLE_SIDE_COLORS[unit.side], 0.85)
      }
      // 白边框只画外轮廓（1×2 两格中间的共享边不画）
      this.strokeUnitBorder(this.unitGraphics, footprint, 0xffffff, 2)
      const c1 = this.layout.hexToPixel(pos)
      const c2 = unit.size === 2 ? this.layout.hexToPixel({ q: pos.q + 1, r: pos.r }) : c1
      const cx = (c1.x + c2.x) / 2
      const cy = c1.y
      // 中央大字：兵种格上显示文本（来自配置 gridLabel，如「刀」「弓」「骑兵」）
      // active 检查：对象被销毁（残留于 Map）时重建，避免"文字有时消失"
      let label = this.unitLabels.get(unit.id)
      if (!label || !label.active) {
        label = this.add
          .text(cx, cy, '', { fontFamily: 'sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold' })
          .setOrigin(0.5)
          .setDepth(4)
        this.unitLabels.set(unit.id, label)
      }
      label.setPosition(cx, cy)
      label.setText(def.gridLabel)
      // 右下角小字：兵力数量（黑色，靠底边，不与中央大字重叠）
      let count = this.unitCounts.get(unit.id)
      if (!count || !count.active) {
        count = this.add
          .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#000000' })
          .setOrigin(1, 1)
          .setDepth(4)
        this.unitCounts.set(unit.id, count)
      }
      count.setPosition(c2.x + this.layout.size * 0.6, c2.y + this.layout.size * 0.85)
      count.setText(String(unit.count))
      seen.add(unit.id)
    }
    for (const unit of this.state.units) draw(unit)
    for (const [id, t] of this.unitLabels) {
      if (!seen.has(id)) {
        t.destroy()
        this.unitLabels.delete(id)
      }
    }
    for (const [id, t] of this.unitCounts) {
      if (!seen.has(id)) {
        t.destroy()
        this.unitCounts.delete(id)
      }
    }
  }

  /** 当前单位金色描边+三角箭头；玩家当前单位的可达格高亮 + 选中高亮 */
  private drawOverlay(): void {
    this.overlayGraphics.clear()
    const state = this.state
    if (state.phase !== 'combat') return
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (current) {
      const pos = this.visualPos.get(current.id) ?? current.position
      // 黄色高亮只描外轮廓（1×2 两格中间的共享边不画）
      this.strokeUnitBorder(this.overlayGraphics, occupiedHexes({ position: pos, size: current.size }), 0xffcc33, 3)
      const c = this.layout.hexToPixel(pos)
      this.overlayGraphics.fillStyle(0xffcc33, 1)
      this.overlayGraphics.fillTriangle(c.x, c.y - 40, c.x - 9, c.y - 27, c.x + 9, c.y - 27)
    }
    // 可达范围闪烁画在低 depth 的 reachGraphics（单位之下），不压住单位
    this.reachGraphics.clear()
    if (current && current.side === 'player') {
      // 可达高亮覆盖 1×2 完整占地（主格 + 东邻格）：落脚时双格都在高亮内，不会"一脚里一脚外"
      // 慢速脉动（闪烁）标识"这是可移动范围"；Set 去重保证每格只填一次（否则相邻占地重叠格会更亮、边界更暗）
      const a = 0.18 + 0.1 * Math.abs(Math.sin(this.blinkPhase * 0.25))
      const drawn = new Set<string>()
      for (const hex of battleReachableArea(current, state)) {
        for (const h of occupiedHexes({ position: hex, size: current.size })) {
          const k = hexKey(h)
          if (drawn.has(k)) continue
          drawn.add(k)
          this.fillHex(this.reachGraphics, h, REACHABLE_FILL, a)
        }
      }
    }
    if (state.selectedUnitId) {
      const sel = state.units.find((u) => u.id === state.selectedUnitId)
      if (sel) for (const hex of occupiedHexes(sel)) this.strokeHex(this.overlayGraphics, hex, 0xffffff, 2)
    }
  }

  /** 同步左上角 log + 后台输出新增条目（每段动作完成后立即调用，保证 log 与动画一致） */
  private syncLog(): void {
    this.logText.setText(this.state.log.slice(-6).join('\n'))
    this.flushLog()
  }

  private updateLogAndResult(): void {
    this.syncLog()
    const terminal = this.state.phase !== 'combat'
    this.resultText.setVisible(terminal)
    this.returnButton.setVisible(terminal)
    // 结算时隐藏战斗操作按钮（跳过行动 / 撤退）
    this.operationButtons?.setVisible(!terminal)
    this.turnOrderQueue?.setVisible(!terminal)
    if (terminal) {
      this.resultText.setText(this.state.phase === 'won' ? '胜利' : '战败')
      this.positionResult()
    }
  }

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

  /**
   * 若当前是敌方单位，自动行动直到轮到我方或战斗结束。
   * 防御：行动若无效（如移动被拒）则强制 endTurn，杜绝死循环。
   * 异步版本：逐个 await 移动动画，让玩家看到 AI 逐格移动。
   */
  private async stepEnemyAi(): Promise<void> {
    if (this.enemyActing || this.state.phase !== 'combat' || this.currentSide() !== 'enemy') return
    this.enemyActing = true
    try {
      let guard = 0
      while (this.state.phase === 'combat' && this.currentSide() === 'enemy' && guard++ < 50) {
        // 每步行动之间停顿：让玩家看清上一步的结果（如敌方弓兵秒杀前有一拍）
        await this.sleep(this.actionGapMs)
        const action = planEnemyAction(this.state)
        const curId = this.state.currentUnitId as string
        const before = this.state.units.find((u) => u.id === curId) as BattleUnit
        if (action.type === 'move') {
          const path = battleFindPath(before, action.to, this.state) ?? [action.to]
          await this.animateMove(curId, path) // 先播移动动画，动画结束才落状态
          this.store.dispatch('battle/move', { unitId: curId, to: action.to })
          this.syncLog() // 敌方移动完成 → 立即输出移动 log
          const moved = this.state.units.find((u) => u.id === curId) as BattleUnit
          if (hexKey(moved.position) === hexKey(before.position)) {
            this.visualPos.delete(curId) // 移动被拒 → 清除动画残留，回原位
            this.store.dispatch('battle/endTurn', { unitId: curId })
          }
        } else if (action.type === 'attack') {
          const path = hexKey(action.to) === hexKey(before.position)
            ? []
            : (battleFindPath(before, action.to, this.state) ?? [action.to])
          const hpBefore = new Map(this.state.units.map((u) => [u.id, u.hpLeft] as const))
          const posBefore = new Map(this.state.units.map((u) => [u.id, { pos: u.position, size: u.size }] as const))
          if (path.length > 0) await this.animateMove(curId, path) // 先冲锋动画
          this.sfx?.playOnce('melee attack') // 敌方近战音效
          this.store.dispatch('battle/attack', { unitId: curId, targetId: action.targetId, to: action.to })
          this.syncLog() // 敌方主攻段完成 → 立即输出攻击 log
          await this.resolveMelee(hpBefore, posBefore, curId, action.targetId, action.to, before.size) // 主攻闪目标；反击分段
        } else if (action.type === 'shoot') {
          const hpBefore = new Map(this.state.units.map((u) => [u.id, u.hpLeft] as const))
          const posBefore = new Map(this.state.units.map((u) => [u.id, { pos: u.position, size: u.size }] as const))
          this.sfx?.playOnce('range attack') // 敌方远程音效
          this.store.dispatch('battle/shoot', { unitId: curId, targetId: action.targetId })
          this.syncLog() // 敌方射击完成 → 立即输出射击 log
          if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
            this.store.dispatch('battle/endTurn', { unitId: curId })
          }
          // 远程攻击：攻方与被攻击方都闪，时间稍久
          this.playHitFlash(before.position, before.size, 550)
          this.flashDamageDealt(hpBefore, posBefore, 550)
        } else {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
        this.syncViews()
      }
    } finally {
      this.enemyActing = false
    }
  }

  private currentSide(): BattleUnit['side'] | null {
    return this.state.units.find((x) => x.id === this.state.currentUnitId)?.side ?? null
  }

  private endCurrentTurn(): void {
    if (this.busy || this.state.phase !== 'combat' || this.currentSide() !== 'player') return
    this.store.dispatch('battle/endTurn', { unitId: this.state.currentUnitId as string })
    this.refreshViews()
  }

  private surrender(): void {
    this.store.dispatch('battle/surrender')
    this.refreshViews()
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.off('pointerdown')
    this.input.off('pointerup')
    this.input.off('pointermove')
    // 切场防抖：主菜单按钮 pointerdown 触发 scene.start 后，同一次点击的收尾 pointerup
    // 会泄漏进新场景的全局监听 → 误触发一次操作（把当前行动单位移到按钮所在格）。
    // 若场景启动时指针仍按下，说明该 pointerup 属于旧场景的点击：吞掉它（只吞一次）。
    let swallowStaleUp = this.input.activePointer.isDown
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // 点在 UI 控件（跳过/撤退/BGM 音量条等）上 → 不启动地图拖拽（与 pointerup 一致）
      if (this.input.hitTestPointer(p).length > 0) return
      // 记录按下点：用于区分「点击」与「拖拽平移相机」
      this.dragging = true
      this.downPos = { x: p.x, y: p.y }
      this.lastPointer = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (swallowStaleUp) {
        swallowStaleUp = false
        return
      }
      this.dragging = false
      if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
      // 点在 UI 控件（跳过/撤退/BGM 等）上 → 不触发地图操作
      if (this.input.hitTestPointer(p).length > 0) return
      // 位移过大 = 拖拽平移地图，不算点击
      const moved = Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y)
      if (moved > 6 || this.busy) return
      this.handleClick(this.layout.pixelToHex(p.worldX, p.worldY))
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) {
        // 拖拽平移相机（战场 zoom=1，直接按像素位移）
        this.cameras.main.scrollX -= p.x - this.lastPointer.x
        this.cameras.main.scrollY -= p.y - this.lastPointer.y
        this.lastPointer = { x: p.x, y: p.y }
        return
      }
      this.onHover(p)
    })
  }

  private onHover(pointer: Phaser.Input.Pointer): void {
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const hex = this.layout.pixelToHex(pointer.worldX, pointer.worldY)
    const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
    this.updateInfoPanel(unitAt ?? null)
    this.hover.ghostHex = null
    this.hover.swordHex = null
    this.hover.swordAdjHex = null
    this.hover.swordTargetId = null
    this.hover.blinkId = null
    this.hover.cursorKind = 'none'
    // busy（结算中）→ 不显示刀剑/弓/移动等"可操作"光标，保持默认指针
    if (this.busy || !current || state.phase !== 'combat' || current.side !== 'player') {
      this.drawHoverLayer()
      return
    }
    const isRanged = UNIT_DEFS[current.defId].range > 1
    // 远程：悬停敌军 → 弓/断箭（未移动 + 未被贴身）
    if (isRanged && unitAt && unitAt.side !== current.side && !current.hasMoved && !this.isPinned(current, state)) {
      const inRange = occupiedHexes(unitAt).some((h) => this.hexDist(current.position, h) <= UNIT_DEFS[current.defId].range)
      this.hover.cursorKind = inRange ? 'bow' : 'broken-arrow'
      this.hover.blinkId = unitAt.id
      this.drawHoverLayer()
      return
    }
    // 近战贴身：悬停相邻敌军本体 → 刀剑（原地攻击，无需找共享边界）
    if (!isRanged && unitAt && unitAt.side !== current.side &&
      occupiedHexes(current).some((h) => occupiedHexes(unitAt).some((uh) => hexDistance(h, uh) <= 1))) {
      this.hover.cursorKind = 'sword'
      this.hover.swordTargetId = unitAt.id
      this.hover.swordHex = current.position
      this.hover.ghostHex = null
      this.hover.blinkId = unitAt.id
      this.drawHoverLayer()
      return
    }
    // 近战：扫描可达落点与其相邻敌军的共享边界，命中最近者
    const reachable = battleReachableArea(current, state)
    const mx = pointer.worldX
    const my = pointer.worldY
    let edgeHit: { targetId: string; dist: number; dest: Axial } | null = null
    for (const dest of reachable) {
      // 攻击方在该落点的体格（1×2 = 主格+东邻格）：任一体格贴敌都算够得着 → 刀剑画在该体格边界
      for (const bodyHex of occupiedHexes({ position: dest, size: current.size })) {
        for (let d = 0; d < 6; d++) {
          const nb = hexNeighbor(bodyHex, d as HexDir)
          const foe = state.units.find((u) => u.side !== current.side && occupiedHexes(u).some((h) => hexKey(h) === hexKey(nb)))
          if (!foe) continue
          const c1 = (6 - d) % 6
          const c2 = (c1 + 1) % 6
          const p1 = this.layout.cornerAt(bodyHex, c1)
          const p2 = this.layout.cornerAt(bodyHex, c2)
          const dist = this.distToSegment(mx, my, p1.x, p1.y, p2.x, p2.y)
          if (dist <= EDGE_HIT_TOLERANCE && (!edgeHit || dist < edgeHit.dist)) {
            edgeHit = { targetId: foe.id, dist, dest }
          }
        }
      }
    }
    if (edgeHit) {
      this.hover.cursorKind = 'sword'
      this.hover.swordTargetId = edgeHit.targetId
      this.hover.swordHex = edgeHit.dest
      this.hover.ghostHex = hexKey(edgeHit.dest) === hexKey(current.position) ? null : edgeHit.dest
      this.hover.blinkId = edgeHit.targetId
    } else {
      const ghost = reachable.find((h) => hexKey(h) === hexKey(hex)) ?? null
      this.hover.ghostHex = ghost
      this.hover.cursorKind = ghost ? 'move' : 'none'
    }
    this.drawHoverLayer()
  }

  private isPinned(unit: BattleUnit, state: BattleState): boolean {
    return state.units.some((u) =>
      u.id !== unit.id && u.side !== unit.side &&
      occupiedHexes(unit).some((h) => occupiedHexes(u).some((uh) => hexDistance(h, uh) <= 1)))
  }

  private distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    return Math.hypot(px - cx, py - cy)
  }

  private drawHoverLayer(): void {
    this.hoverGraphics.clear()
    // 结算中：不画刀剑/弓箭/残影等"可操作"光标图形（hover 状态保留，供 handleClick 判断）
    if (this.busy) return
    const h = this.hover
    // 目的地残影：同色（蓝）静态更亮，指示去向（不闪烁；可达区才闪烁）
    if (h.ghostHex) {
      const current = this.state.units.find((u) => u.id === this.state.currentUnitId)
      const size = current?.size ?? 1
      for (const hex of occupiedHexes({ position: h.ghostHex, size })) {
        this.fillHex(this.hoverGraphics, hex, REACHABLE_FILL, 0.5)
      }
    }
    // 目标闪烁（脉动 alpha）
    if (h.blinkId) {
      const target = this.state.units.find((u) => u.id === h.blinkId)
      if (target) {
        const alpha = 0.35 + 0.35 * Math.abs(Math.sin(this.blinkPhase))
        for (const hex of occupiedHexes(target)) this.fillHex(this.hoverGraphics, hex, 0xff0000, alpha)
      }
    }
    // 刀剑：画在目的格与目标之间的边界上，剑尖指向目标
    if (h.cursorKind === 'sword' && h.swordTargetId && h.swordHex) {
      this.drawSword(h.swordHex, h.swordTargetId)
    }
    // 弓 / 断箭：目标上方画弓弧（断箭加斜线）
    if (h.cursorKind === 'bow' || h.cursorKind === 'broken-arrow') {
      const target = h.blinkId ? this.state.units.find((u) => u.id === h.blinkId) : null
      if (target) {
        const c = this.layout.hexToPixel(target.position)
        const g = this.hoverGraphics
        g.lineStyle(2, h.cursorKind === 'bow' ? 0xffcc33 : 0xff6644, 1)
        g.beginPath()
        g.arc(c.x, c.y - 20, 12, Math.PI, 0, false)
        g.strokePath()
        if (h.cursorKind === 'broken-arrow') {
          g.lineBetween(c.x - 8, c.y - 8, c.x + 4, c.y + 4)
        }
      }
    }
  }

  private drawSword(dest: Axial, targetId: string): void {
    const target = this.state.units.find((u) => u.id === targetId)
    if (!target) return
    const attacker = this.state.units.find((u) => u.id === this.state.currentUnitId)
    // 刀剑锚在攻击方体积内与目标相邻的体格上（贴身 1×2 时画在「东邻格↔敌军」边界，而非主体格内）
    const body = attacker ? occupiedHexes({ position: dest, size: attacker.size }) : [dest]
    const adj = body.find((h) => occupiedHexes(target).some((uh) => hexDistance(h, uh) <= 1)) ?? dest
    this.hover.swordAdjHex = adj
    const dPos = this.layout.hexToPixel(adj)
    const tPos = this.layout.hexToPixel(target.position)
    const mid = { x: (dPos.x + tPos.x) / 2, y: (dPos.y + tPos.y) / 2 }
    const ang = Math.atan2(tPos.y - dPos.y, tPos.x - dPos.x)
    const g = this.hoverGraphics
    g.save()
    g.translateCanvas(mid.x, mid.y)
    g.rotateCanvas(ang)
    g.fillStyle(0xe0e4ec, 1)
    g.fillRect(-16, -2.5, 22, 5)   // 剑身（正 x 方向为剑尖）
    g.fillStyle(0xffcc33, 1)
    g.fillRect(-16, -6, 4, 12)     // 护手
    g.fillStyle(0x8a5a2b, 1)
    g.fillRect(6, -4, 9, 8)        // 剑柄
    g.restore()
  }

  private updateInfoPanel(unit: BattleUnit | null): void {
    if (!unit) {
      this.infoPanel.setVisible(false)
      return
    }
    const def = UNIT_DEFS[unit.defId]
    const gen = this.state.general[unit.side]
    this.infoPanel.setText([
      def.name,
      `数量：${unit.count}`,
      `攻击：${def.attack}（+${gen.atkBonus}）`,
      `防御：${def.defense}（+${gen.defBonus}）`,
      `伤害：${def.minDamage}~${def.maxDamage}`,
      `速度：${def.speed}`,
      `伤兵剩余：${woundedHp(unit)} 血`
    ])
    const p = this.input.activePointer
    this.infoPanel.setPosition(p.x + 16, p.y + 16).setVisible(true)
  }

  private async handleClick(hex: Axial): Promise<void> {
    // 动画/结算中不可操作下一单位（busy 覆盖冲锋+攻击+反击停顿+闪白）
    if (this.animActive || this.animQueue.length > 0 || this.busy) return
    this.busy = true
    try {
      await this.doHandleClick(hex)
    } finally {
      this.busy = false
    }
  }

  private async doHandleClick(hex: Axial): Promise<void> {
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (!current || current.side !== 'player') return
    const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
    if (this.hover.cursorKind === 'sword' && this.hover.swordTargetId && this.hover.swordHex) {
      const to = this.hover.swordHex
      const targetId = this.hover.swordTargetId // 提前捕获：冲锋动画期间鼠标移动会改写 hover，落刀必须用这个目标
      const path = hexKey(to) === hexKey(current.position) ? [] : (battleFindPath(current, to, this.state) ?? [to])
      const hpBefore = new Map(state.units.map((u) => [u.id, u.hpLeft] as const))
      const posBefore = new Map(state.units.map((u) => [u.id, { pos: u.position, size: u.size }] as const))
      if (path.length > 0) await this.animateMove(current.id, path) // 先冲锋动画，落刀再结算
      this.sfx?.playOnce('melee attack') // 近战（含远程兵近战）落刀音效
      this.store.dispatch('battle/attack', { unitId: current.id, targetId, to })
      this.syncLog() // 主攻段完成 → 立即输出攻击 log（不等反击）
      await this.resolveMelee(hpBefore, posBefore, current.id, targetId, to, current.size) // 主攻闪目标；反击分段
      this.refreshViews()
      return
    }
    if ((this.hover.cursorKind === 'bow' || this.hover.cursorKind === 'broken-arrow') && unitAt && unitAt.side !== current.side) {
      const hpBefore = new Map(state.units.map((u) => [u.id, u.hpLeft] as const))
      const posBefore = new Map(state.units.map((u) => [u.id, { pos: u.position, size: u.size }] as const))
      this.sfx?.playOnce('range attack') // 远程射击音效
      this.store.dispatch('battle/shoot', { unitId: current.id, targetId: unitAt.id })
      this.syncLog() // 射击段完成 → 立即输出射击 log
      // 远程攻击：攻方与被攻击方都闪，时间稍久，让远程攻击更显眼
      this.playHitFlash(current.position, current.size, 550)
      this.flashDamageDealt(hpBefore, posBefore, 550)
      this.refreshViews()
      return
    }
    // 移动优先于选中：1×2 单位可滑入自身东邻格（点击该格 = 右移一格）。
    // 他人单位占据格不在可达集内，故"点击他人单位 → 选中"不受影响；点击自身主体格仍回退到选中。
    const reachable = battleReachableArea(current, state)
    if (hexKey(hex) !== hexKey(current.position) && reachable.some((h) => hexKey(h) === hexKey(hex))) {
      const path = battleFindPath(current, hex, this.state) ?? [hex]
      await this.animateMove(current.id, path) // 先播移动动画，动画结束才落状态
      this.store.dispatch('battle/move', { unitId: current.id, to: hex })
      this.syncLog() // 移动完成 → 立即输出移动 log
      this.refreshViews()
      return
    }
    if (unitAt && unitAt.side === 'player') {
      this.store.dispatch('battle/select', { unitId: unitAt.id })
      this.refreshViews()
      return
    }
  }

  // ---------- 受击特效 ----------

  /** 受击闪白：在指定占据格画白色半透明填充后淡出销毁；duration 默认 350ms */
  private playHitFlash(at: Axial, size: 1 | 2, duration = 350): void {
    const g = this.add.graphics().setDepth(6)
    for (const hex of occupiedHexes({ position: at, size })) {
      this.fillHex(g, hex, 0xffffff, 0.85)
    }
    this.hitFlashCount++
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy()
    })
  }

  /**
   * 结算一次战斗动作的受击闪白：对比攻击前后 hpLeft，谁掉血谁闪（主攻目标 + 反击目标）。
   * 位置用攻击前的 posBefore，被消灭的单位也能闪（用最后位置）。
   */
  private flashDamageDealt(
    hpBefore: Map<string, number>,
    posBefore: Map<string, { pos: Axial; size: 1 | 2 }>,
    duration = 350,
    exclude?: Set<string>
  ): void {
    for (const [id, prev] of hpBefore) {
      if (exclude?.has(id)) continue
      const after = this.state.units.find((u) => u.id === id)
      const damaged = after ? after.hpLeft < prev : true // 不在 units 里 = 本动作被消灭
      if (damaged) {
        const p = posBefore.get(id)
        if (p) this.playHitFlash(p.pos, p.size, duration)
      }
    }
  }

  /**
   * 近战攻击结算（含反击）：先闪主攻目标；若攻击方被反击掉血，停顿后闪反击方 + 音效。
   * 主攻音效由调用方在 dispatch 前播放。
   */
  /**
   * 近战结算（分段）：主攻 `battle/attack` 已由调用方 dispatch。
   * 这里：闪主攻目标 → 若可反击则停顿后 dispatch `battle/retaliate`（反击+推进）并闪反击方，
   * 否则 dispatch `battle/advance` 推进。动画与数据分段一致，不超前计算。
   */
  private async resolveMelee(
    hpBefore: Map<string, number>,
    posBefore: Map<string, { pos: Axial; size: 1 | 2 }>,
    attackerId: string,
    targetId: string,
    attackerDest: Axial,
    attackerSize: 1 | 2
  ): Promise<void> {
    // 攻击结算后立即刷新：移动单位显示在落点，反击停顿期间不会"瞬移回原位"
    this.drawUnits()
    // 主攻：闪目标（排除攻击者自身）
    this.flashDamageDealt(hpBefore, posBefore, 350, new Set([attackerId]))
    // 反击分段：目标存活且能反击 → 停顿后 dispatch retaliate（此刻才结算反击伤害）
    if (this.state.phase === 'combat' && canRetaliate(this.state, targetId, attackerId)) {
      await this.sleep(this.actionGapMs)
      this.sfx?.playOnce('melee attack')
      this.store.dispatch('battle/retaliate', { retaliatorId: targetId, victimId: attackerId })
      this.syncLog() // 反击段完成 → 立即输出反击 log
      // 反击闪在攻击者【冲锋后落点】（被打灭也用落点）
      this.playHitFlash(attackerDest, attackerSize)
    } else if (this.state.phase === 'combat') {
      this.store.dispatch('battle/advance')
    }
  }

  // ---------- helpers ----------

  private hexDist(a: Axial, b: Axial): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r))
  }

  private fillHex(g: Phaser.GameObjects.Graphics, hex: Axial, color: number, alpha: number): void {
    const pts: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const p = this.layout.cornerAt(hex, i)
      pts.push(new Phaser.Math.Vector2(p.x, p.y))
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  private strokeHex(g: Phaser.GameObjects.Graphics, hex: Axial, color: number, width: number): void {
    const pts: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const p = this.layout.cornerAt(hex, i)
      pts.push(new Phaser.Math.Vector2(p.x, p.y))
    }
    g.lineStyle(width, color, 1)
    g.strokePoints(pts, true)
  }

  /** 只描单位占地【外轮廓】：1×2 两格中间的共享边不画（邻格在占地内的边跳过） */
  private strokeUnitBorder(g: Phaser.GameObjects.Graphics, footprint: Axial[], color: number, width: number): void {
    const keys = new Set(footprint.map(hexKey))
    g.lineStyle(width, color, 1)
    for (const hex of footprint) {
      for (let d = 0; d < 6; d++) {
        const nb = hexNeighbor(hex, d as HexDir)
        if (keys.has(hexKey(nb))) continue // 内部共享边跳过
        const c1 = (6 - d) % 6
        const c2 = (c1 + 1) % 6
        const p1 = this.layout.cornerAt(hex, c1)
        const p2 = this.layout.cornerAt(hex, c2)
        g.lineBetween(p1.x, p1.y, p2.x, p2.y)
      }
    }
  }

  /** 结算区（结果文字 + 返回按钮）作为整体：水平居中 + 垂直居中（组内文字/按钮各自水平居中） */
  private positionResult(): void {
    const cam = this.cameras.main
    const cx = cam.width / 2
    if (!this.resultText || !this.returnButton) return
    const textH = this.resultText.height
    const btnH = this.returnButton.height
    const GAP = 28
    const groupH = textH + GAP + btnH
    const top = cam.height / 2 - groupH / 2
    this.resultText.setPosition(cx, top + textH / 2)
    this.returnButton.setPosition(cx, top + textH + GAP + btnH / 2)
  }

  /** 逐格移动动画耗时（ms）；0 = 瞬间完成（e2e 用）；同时关掉行动间隔 */
  setAnimationSpeed(ms: number): void {
    this.animationMs = ms
    if (ms <= 0) this.actionGapMs = 0
  }

  /** 行动间隔（ms）；0 = 无停顿（e2e 用） */
  setActionGap(ms: number): void {
    this.actionGapMs = Math.max(0, ms)
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** 移动动画结束后 resolve；无动画立即 resolve */
  waitForMove(): Promise<void> {
    if (!this.animActive && this.animQueue.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.moveWaiter = resolve
    })
  }

  // ---------- 移动动画 ----------

  /** 移动音效 key：骑兵走马步、其余走步兵步；循环播放直到移动结束 */
  private playMoveSound(unitId: string): void {
    const unit = this.state.units.find((u) => u.id === unitId)
    const key = unit?.defId === 'cavalry' ? 'horse move' : 'infantry move'
    this.sfx?.playLooped(key)
  }

  private animateMove(unitId: string, path: Axial[]): Promise<void> {
    if (this.animationMs <= 0 || path.length === 0) return Promise.resolve()
    this.visualPos.set(unitId, path[0] as Axial)
    if (!this.animActive && this.animQueue.length === 0) this.playMoveSound(unitId)
    return new Promise((resolve) => {
      this.animQueue.push({ unitId, path, resolve })
    })
  }

  private startNextAnim(): void {
    const item = this.animQueue.shift()
    if (!item) return
    this.animActive = { unitId: item.unitId, path: item.path, idx: 0, acc: 0, resolve: item.resolve }
    this.visualPos.set(item.unitId, item.path[0] as Axial)
    this.playMoveSound(item.unitId)
  }

  private updateAnimation(delta: number): void {
    if (this.animActive) {
      this.animActive.acc += delta
      const stepMs = Math.max(1, this.animationMs)
      if (this.animActive.acc >= stepMs) {
        this.animActive.acc -= stepMs
        this.animActive.idx++
        if (this.animActive.idx >= this.animActive.path.length) {
          const done = this.animActive
          // 不删 visualPos：单位保留在落点，避免完成帧画回"原位"闪一下（状态在调用方 dispatch 后才更新）
          this.animActive = null
          this.sfx?.stopLooped() // 移动结束 → 停循环音效
          done.resolve()
          this.startNextAnim()
        } else {
          this.visualPos.set(this.animActive.unitId, this.animActive.path[this.animActive.idx] as Axial)
        }
      }
      this.drawUnits()
    } else {
      this.startNextAnim()
    }
    this.drainWaiters()
  }

  private drainWaiters(): void {
    if (this.animActive || this.animQueue.length > 0) return
    const w = this.moveWaiter
    this.moveWaiter = null
    w?.()
  }

  // ---------- log / 导出 ----------

  /** 新增 log 条目 → console（后台日志流）+ 累计缓冲（供下载） */
  private flushLog(): void {
    const log = this.state.log
    for (let i = this.logFlushed; i < log.length; i++) {
      const entry = log[i]
      if (entry === undefined) continue
      console.log(`[battle] ${entry}`)
      this.logBuffer.push(entry)
    }
    this.logFlushed = log.length
  }

  /** 完整 log 文本（每行一条标准化动作） */
  getFullLog(): string {
    return this.logBuffer.join('\n')
  }

  /** 导出当前战斗状态为 JSON（复现 / debug 用）：含 state + 完整 log + 行动序 */
  exportState(): string {
    return JSON.stringify({ grid: this.state.grid, turn: this.state.turn, order: this.state.order, units: this.state.units, general: this.state.general, phase: this.state.phase, log: this.state.log }, null, 2)
  }

  /** 下载完整 log 为 .log 文件（浏览器 Blob 下载） */
  downloadLog(): void {
    const blob = new Blob([this.getFullLog()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `battle-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---------- dev / e2e ----------

  /** 对象渲染盒（诊断用） */
  private boundsOf(o: Phaser.GameObjects.GameObject): { x: number; y: number; width: number; height: number } {
    const b = (o as unknown as { getBounds(): Phaser.Geom.Rectangle }).getBounds()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  }

  getDebugState(): Record<string, unknown> {
    if (!this.store) return { ready: false }
    const state = this.state
    const cam = this.cameras.main
    const screen = (h: Axial): { x: number; y: number } => {
      const p = this.layout.hexToPixel(h)
      return { x: p.x - cam.scrollX, y: p.y - cam.scrollY }
    }
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const reachMains = current && state.phase === 'combat' ? battleReachableArea(current, state) : []
    const reachable = reachMains.map((h) => ({ q: h.q, r: h.r, screen: screen(h) }))
    // 可达高亮的完整占地（1×2 = 主格+东邻格；与 drawOverlay 一致）
    const reachableFootprint =
      current && state.phase === 'combat'
        ? reachMains.flatMap((h) => occupiedHexes({ position: h, size: current.size }).map((f) => ({ q: f.q, r: f.r })))
        : []
    return {
      ready: true,
      scene: 'battle',
      bgm: getBgmManager(this).getState(),
      bgmControls: this.bgmControls?.getDebugState() ?? null,
      sfx: this.sfx?.getState() ?? null,
      phase: state.phase,
      camera: { scrollX: Math.round(this.cameras.main.scrollX), scrollY: Math.round(this.cameras.main.scrollY) },
      turn: state.turn,
      animating: this.animActive !== null || this.animQueue.length > 0,
      actionGapMs: this.actionGapMs,
      hitFlashCount: this.hitFlashCount,
      // 诊断：所有在场单位的格上文本对象是否都存活（无"文字消失"）
      textOk: state.units.every(
        (u) => (this.unitLabels.get(u.id)?.active ?? false) && (this.unitCounts.get(u.id)?.active ?? false)
      ),
      currentUnitId: state.currentUnitId,
      selectedUnitId: state.selectedUnitId,
      grid: state.grid,
      obstacles: state.obstacles,
      order: state.order,
      turnQueue: buildTurnOrderQueue(state),
      log: state.log,
      reachable,
      reachableFootprint,
      hover: {
        ghostHex: this.hover.ghostHex,
        swordHex: this.hover.swordHex,
        swordAdjHex: this.hover.swordAdjHex,
        cursorKind: this.hover.cursorKind,
        swordTargetId: this.hover.swordTargetId,
        blinkId: this.hover.blinkId
      },
      infoPanelText: this.infoPanel && this.infoPanel.visible ? this.infoPanel.text : null,
      // 结算元素真实坐标（诊断：验证结果文字/返回按钮水平居中；bounds = 渲染盒）
      result: {
        camWidth: this.cameras.main.width,
        scaleWidth: this.scale.width,
        buttons: {
          opButtonsVisible: this.operationButtons?.isVisible() ?? null,
          resultVisible: this.resultText?.visible ?? null
        },
        text: this.resultText
          ? {
              x: this.resultText.x,
              dw: this.resultText.displayWidth,
              ox: this.resultText.originX,
              bounds: this.boundsOf(this.resultText)
            }
          : null,
        button: this.returnButton
          ? {
              x: this.returnButton.x,
              dw: this.returnButton.displayWidth,
              ox: this.returnButton.originX,
              bounds: this.boundsOf(this.returnButton)
            }
          : null
      },
      units: state.units.map((u) => ({
        id: u.id,
        side: u.side,
        defId: u.defId,
        /** 格上中央大字（配置 gridLabel，与 drawUnits 一致） */
        gridLabel: UNIT_DEFS[u.defId].gridLabel,
        count: u.count,
        position: u.position,
        size: u.size,
        hpLeft: u.hpLeft,
        maxHp: u.maxHp,
        hasActed: u.hasActed,
        hasMoved: u.hasMoved,
        retaliated: u.retaliated,
        woundedHp: woundedHp(u),
        screen: screen(u.position)
      }))
    }
  }
}
