import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { battleReducer, createInitialBattleState } from '../core/battle/battleReducer'
import { planEnemyAction } from '../core/battle/ai'
import { battleReachableArea } from '../core/battle/pathing'
import { occupiedHexes, woundedHp, type BattleArmyConfig, type BattleState, type BattleUnit } from '../core/battle/types'
import { hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_GRID, BATTLE_OBSTACLES, ENEMY_ARMY, PLAYER_ARMY } from '../data/battleTest'
import { MainMenuScene } from './MainMenuScene'

const SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const
const GRID_COLOR = 0x1a2333
const GRID_LINE = 0x0b0f18
const REACHABLE_FILL = 0x66ccff
/**
 * 战斗场景（渲染层）。职责：读 BattleState 渲染 + 把点击/按钮转成 battle 命令。
 * 交互：
 * - 点击己方单位 → select（高亮）；点击可达空格 → move；点击射程内敌人 → attack
 * - 当前单位「跳过行动」；敌方单位由 planEnemyAction 自动行动
 * - 胜负 → 显示结果 + 返回主菜单
 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'Battle'

  private readonly layout = new HexLayout({ size: 30, origin: { x: 0, y: 0 } })
  private store!: CommandLog<BattleState>
  private gridGraphics!: Phaser.GameObjects.Graphics
  private overlayGraphics!: Phaser.GameObjects.Graphics
  private unitGraphics!: Phaser.GameObjects.Graphics
  private obstacleGraphics!: Phaser.GameObjects.Graphics
  private unitTexts = new Map<string, Phaser.GameObjects.Text>()
  // @ts-expect-error 预留字段，Task 7 信息面板使用
  private infoPanel!: Phaser.GameObjects.Text
  // @ts-expect-error 预留字段，Task 8 动画速度控制使用
  private animationMs = 0
  private visualPos = new Map<string, Axial>()
  private animQueue: Axial[] = []
  // @ts-expect-error 预留字段，Task 8 移动动画使用
  private animActive: Phaser.Tweens.Tween | null = null
  private resultText!: Phaser.GameObjects.Text
  private returnButton!: Phaser.GameObjects.Text
  private logText!: Phaser.GameObjects.Text

  constructor() {
    super(BattleScene.KEY)
  }

  create(): void {
    this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
    this.store.dispatch('battle/init', {
      player: PLAYER_ARMY,
      enemy: ENEMY_ARMY,
      grid: { ...BATTLE_GRID, obstacles: BATTLE_OBSTACLES }
    })
    this.createLayers()
    this.setupBattle()
  }

  /** 直接以指定阵容/网格开局（e2e 确定性交互测试） */
  startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void {
    this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
    this.store.dispatch('battle/init', { player, enemy, grid })
    this.visualPos.clear()
    this.animQueue.length = 0
    this.animActive = null
    this.drawGrid()
    this.drawObstacles()
    this.setupBattle()
  }

  private setupBattle(): void {
    this.centerCamera()
    this.setupInput()
    this.refreshViews()
  }

  private get state(): BattleState {
    return this.store.getState()
  }

  private createLayers(): void {
    this.gridGraphics = this.add.graphics().setDepth(0)
    this.obstacleGraphics = this.add.graphics().setDepth(1)
    this.unitGraphics = this.add.graphics().setDepth(2)
    this.overlayGraphics = this.add.graphics().setDepth(3)
    this.drawGrid()
    this.drawObstacles()
    // 结果 + 返回主菜单（视口固定，scrollFactor 0）
    this.resultText = this.add
      .text(960, 520, '', { fontFamily: 'sans-serif', fontSize: '48px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setVisible(false)
    this.returnButton = this.add
      .text(960, 580, '返回主菜单', { fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff', backgroundColor: '#33415c' })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(24, 12)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
    this.returnButton.on('pointerdown', () => this.scene.start(MainMenuScene.KEY))
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
    this.makeCornerButton(1880, 1040, '跳过行动', () => this.endCurrentTurn())
    this.makeCornerButton(1880, 980, '撤退', () => this.surrender())
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

  /** 画单位（1×2 画两格）、数量文本 */
  private drawUnits(): void {
    this.unitGraphics.clear()
    const seen = new Set<string>()
    for (const unit of this.state.units) {
      const pos = this.visualPos.get(unit.id) ?? unit.position
      for (const hex of occupiedHexes({ position: pos, size: unit.size })) {
        this.fillHex(this.unitGraphics, hex, SIDE_COLORS[unit.side], 0.85)
      }
      const c1 = this.layout.hexToPixel(pos)
      const c2 = unit.size === 2 ? this.layout.hexToPixel({ q: pos.q + 1, r: pos.r }) : c1
      const cx = (c1.x + c2.x) / 2
      let t = this.unitTexts.get(unit.id)
      if (!t) {
        t = this.add
          .text(cx, c1.y, '', { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(4)
        this.unitTexts.set(unit.id, t)
      }
      t.setPosition(cx, c1.y)
      t.setText(String(unit.count))
      seen.add(unit.id)
    }
    for (const id of this.unitTexts.keys()) {
      if (!seen.has(id)) {
        this.unitTexts.get(id)?.destroy()
        this.unitTexts.delete(id)
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
      for (const hex of occupiedHexes({ position: pos, size: current.size })) {
        this.strokeHex(this.overlayGraphics, hex, 0xffcc33, 3)
      }
      const c = this.layout.hexToPixel(pos)
      this.overlayGraphics.fillStyle(0xffcc33, 1)
      this.overlayGraphics.fillTriangle(c.x, c.y - 40, c.x - 9, c.y - 27, c.x + 9, c.y - 27)
    }
    if (current && current.side === 'player') {
      for (const hex of battleReachableArea(current, state)) {
        this.fillHex(this.overlayGraphics, hex, REACHABLE_FILL, 0.18)
      }
    }
    if (state.selectedUnitId) {
      const sel = state.units.find((u) => u.id === state.selectedUnitId)
      if (sel) for (const hex of occupiedHexes(sel)) this.strokeHex(this.overlayGraphics, hex, 0xffffff, 2)
    }
  }

  private updateLogAndResult(): void {
    this.logText.setText(this.state.log.slice(-4).join('\n'))
    const terminal = this.state.phase !== 'combat'
    this.resultText.setVisible(terminal)
    this.returnButton.setVisible(terminal)
    if (terminal) this.resultText.setText(this.state.phase === 'won' ? '胜利！' : '战败…')
  }

  private refreshViews(): void {
    this.drawUnits()
    this.drawOverlay()
    this.updateLogAndResult()
    this.stepEnemyAi()
  }

  /**
   * 若当前是敌方单位，自动行动直到轮到我方或战斗结束。
   * 防御：行动若无效（如移动被拒）则强制 endTurn，杜绝死循环。
   */
  private stepEnemyAi(): void {
    let guard = 0
    while (this.state.phase === 'combat' && this.currentSide() === 'enemy' && guard++ < 50) {
      const action = planEnemyAction(this.state)
      const curId = this.state.currentUnitId as string
      const before = this.state.units.find((u) => u.id === curId) as BattleUnit
      if (action.type === 'move') {
        this.store.dispatch('battle/move', { unitId: curId, to: action.to })
        const moved = this.state.units.find((u) => u.id === curId) as BattleUnit
        // 移动成功则保持当前单位（可继续攻击）；失败则强制结束回合
        if (hexKey(moved.position) === hexKey(before.position)) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
      } else {
        this.store.dispatch(action.type === 'attack' ? 'battle/attack' : 'battle/endTurn', {
          unitId: curId,
          ...(action.type === 'attack' ? { targetId: action.targetId } : {})
        })
        // 成功的攻击/endTurn 必然 advance（currentUnitId 变化）；未变化说明被拒 → 强制结束
        if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
      }
    }
    this.drawUnits()
    this.drawOverlay()
    this.updateLogAndResult()
  }

  private currentSide(): BattleUnit['side'] | null {
    return this.state.units.find((x) => x.id === this.state.currentUnitId)?.side ?? null
  }

  private endCurrentTurn(): void {
    if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
    this.store.dispatch('battle/endTurn', { unitId: this.state.currentUnitId as string })
    this.refreshViews()
  }

  private surrender(): void {
    this.store.dispatch('battle/surrender')
    this.refreshViews()
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
      this.handleClick(this.layout.pixelToHex(p.worldX, p.worldY))
    })
  }

  private handleClick(hex: Axial): void {
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (!current) return
    const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
    // 点敌方单位且射程内 → 攻击
    if (unitAt && unitAt.side !== current.side) {
      const range = UNIT_DEFS[current.defId].range
      const inRange = occupiedHexes(unitAt).some((h) => this.hexDist(current.position, h) <= range)
      if (inRange) {
        this.store.dispatch('battle/attack', { unitId: current.id, targetId: unitAt.id })
        this.refreshViews()
        return
      }
    }
    // 点己方单位 → 选中
    if (unitAt && unitAt.side === 'player') {
      this.store.dispatch('battle/select', { unitId: unitAt.id })
      this.refreshViews()
      return
    }
    // 点可达空格 → 移动
    if (battleReachableArea(current, state).some((h) => hexKey(h) === hexKey(hex))) {
      this.store.dispatch('battle/move', { unitId: current.id, to: hex })
      this.refreshViews()
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

  private makeCornerButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, label, { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' })
      .setOrigin(1, 0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerdown', onClick)
  }

  /** 战斗移动为瞬移；兼容 dev 桥（e2e 用） */
  setAnimationSpeed(_ms: number): void {}

  // ---------- dev / e2e ----------

  getDebugState(): Record<string, unknown> {
    if (!this.store) return { ready: false }
    const state = this.state
    const cam = this.cameras.main
    const screen = (h: Axial): { x: number; y: number } => {
      const p = this.layout.hexToPixel(h)
      return { x: p.x - cam.scrollX, y: p.y - cam.scrollY }
    }
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const reachable =
      current && state.phase === 'combat'
        ? battleReachableArea(current, state).map((h) => ({ q: h.q, r: h.r, screen: screen(h) }))
        : []
    return {
      ready: true,
      scene: 'battle',
      phase: state.phase,
      turn: state.turn,
      currentUnitId: state.currentUnitId,
      selectedUnitId: state.selectedUnitId,
      grid: state.grid,
      obstacles: state.obstacles,
      order: state.order,
      log: state.log,
      reachable,
      units: state.units.map((u) => ({
        id: u.id,
        side: u.side,
        defId: u.defId,
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
