import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { battleReducer, createInitialBattleState } from '../core/battle/battleReducer'
import { planEnemyAction } from '../core/battle/ai'
import { battleFindPath, battleReachableArea } from '../core/battle/pathing'
import { occupiedHexes, woundedHp, type BattleArmyConfig, type BattleState, type BattleUnit } from '../core/battle/types'
import { hexDistance, hexKey, hexNeighbor, HexLayout, type Axial, type HexDir } from '../core/hex/HexGrid'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_GRID, BATTLE_OBSTACLES, ENEMY_ARMY, PLAYER_ARMY } from '../data/battleTest'
import { MainMenuScene } from './MainMenuScene'

const SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const
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

  private readonly layout = new HexLayout({ size: 30, origin: { x: 0, y: 0 } })
  private store!: CommandLog<BattleState>
  private gridGraphics!: Phaser.GameObjects.Graphics
  private overlayGraphics!: Phaser.GameObjects.Graphics
  private unitGraphics!: Phaser.GameObjects.Graphics
  private obstacleGraphics!: Phaser.GameObjects.Graphics
  private hoverGraphics!: Phaser.GameObjects.Graphics
  private unitTexts = new Map<string, Phaser.GameObjects.Text>()
  private infoPanel!: Phaser.GameObjects.Text
  private blinkPhase = 0
  private hover: {
    ghostHex: Axial | null
    swordHex: Axial | null
    cursorKind: 'sword' | 'bow' | 'broken-arrow' | 'move' | 'none'
    swordTargetId: string | null
    blinkId: string | null
  } = { ghostHex: null, swordHex: null, cursorKind: 'none', swordTargetId: null, blinkId: null }
  private animationMs = 0
  private visualPos = new Map<string, Axial>()
  private animQueue: { unitId: string; path: Axial[]; resolve: () => void }[] = []
  private animActive: { unitId: string; path: Axial[]; idx: number; acc: number; resolve: () => void } | null = null
  private moveWaiter: (() => void) | null = null
  private enemyActing = false
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
    this.enemyActing = false
    this.moveWaiter = null
    this.drawGrid()
    this.drawObstacles()
    this.setupBattle()
  }

  private setupBattle(): void {
    this.centerCamera()
    this.setupInput()
    this.refreshViews()
  }

  update(_time: number, delta: number): void {
    this.blinkPhase += delta * 0.01
    this.updateAnimation(delta)
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
    this.unitGraphics = this.add.graphics().setDepth(2)
    this.overlayGraphics = this.add.graphics().setDepth(3)
    this.hoverGraphics = this.add.graphics().setDepth(5)
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
        const action = planEnemyAction(this.state)
        const curId = this.state.currentUnitId as string
        const before = this.state.units.find((u) => u.id === curId) as BattleUnit
        if (action.type === 'move') {
          const path = battleFindPath(before, action.to, this.state) ?? [action.to]
          this.store.dispatch('battle/move', { unitId: curId, to: action.to })
          const moved = this.state.units.find((u) => u.id === curId) as BattleUnit
          if (hexKey(moved.position) === hexKey(before.position)) {
            this.store.dispatch('battle/endTurn', { unitId: curId })
          } else {
            await this.animateMove(curId, path)
          }
        } else if (action.type === 'attack') {
          const path = hexKey(action.to) === hexKey(before.position)
            ? []
            : (battleFindPath(before, action.to, this.state) ?? [action.to])
          this.store.dispatch('battle/attack', { unitId: curId, targetId: action.targetId, to: action.to })
          const afterUnit = this.state.units.find((u) => u.id === curId)
          if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
            this.store.dispatch('battle/endTurn', { unitId: curId })
          }
          if (afterUnit && hexKey(afterUnit.position) !== hexKey(before.position) && path.length > 0) {
            await this.animateMove(curId, path)
          }
        } else if (action.type === 'shoot') {
          this.store.dispatch('battle/shoot', { unitId: curId, targetId: action.targetId })
          if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
            this.store.dispatch('battle/endTurn', { unitId: curId })
          }
        } else {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
        this.drawUnits()
        this.drawOverlay()
        this.updateLogAndResult()
      }
    } finally {
      this.enemyActing = false
    }
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
    this.input.off('pointerup')
    this.input.off('pointermove')
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
      this.handleClick(this.layout.pixelToHex(p.worldX, p.worldY))
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
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
    this.hover.swordTargetId = null
    this.hover.blinkId = null
    this.hover.cursorKind = 'none'
    if (!current || state.phase !== 'combat' || current.side !== 'player') {
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
    // 近战：扫描可达落点与其相邻敌军的共享边界，命中最近者
    const reachable = battleReachableArea(current, state)
    const mx = pointer.worldX
    const my = pointer.worldY
    let edgeHit: { targetId: string; dist: number; dest: Axial } | null = null
    for (const dest of reachable) {
      for (let d = 0; d < 6; d++) {
        const nb = hexNeighbor(dest, d as HexDir)
        const foe = state.units.find((u) => u.side !== current.side && occupiedHexes(u).some((h) => hexKey(h) === hexKey(nb)))
        if (!foe) continue
        const c1 = (6 - d) % 6
        const c2 = (c1 + 1) % 6
        const p1 = this.layout.cornerAt(dest, c1)
        const p2 = this.layout.cornerAt(dest, c2)
        const dist = this.distToSegment(mx, my, p1.x, p1.y, p2.x, p2.y)
        if (dist <= EDGE_HIT_TOLERANCE && (!edgeHit || dist < edgeHit.dist)) {
          edgeHit = { targetId: foe.id, dist, dest }
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
    const h = this.hover
    // 残影
    if (h.ghostHex) {
      const current = this.state.units.find((u) => u.id === this.state.currentUnitId)
      const size = current?.size ?? 1
      for (const hex of occupiedHexes({ position: h.ghostHex, size })) {
        this.fillHex(this.hoverGraphics, hex, 0xffffff, 0.35)
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
    const dPos = this.layout.hexToPixel(dest)
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

  private handleClick(hex: Axial): void {
    if (this.animActive || this.animQueue.length > 0) return
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (!current || current.side !== 'player') return
    const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
    if (this.hover.cursorKind === 'sword' && this.hover.swordTargetId && this.hover.swordHex) {
      const to = this.hover.swordHex
      const path = hexKey(to) === hexKey(current.position) ? [] : (battleFindPath(current, to, this.state) ?? [to])
      this.store.dispatch('battle/attack', { unitId: current.id, targetId: this.hover.swordTargetId, to })
      if (path.length > 0) void this.animateMove(current.id, path)
      this.refreshViews()
      return
    }
    if ((this.hover.cursorKind === 'bow' || this.hover.cursorKind === 'broken-arrow') && unitAt && unitAt.side !== current.side) {
      this.store.dispatch('battle/shoot', { unitId: current.id, targetId: unitAt.id })
      this.refreshViews()
      return
    }
    if (unitAt && unitAt.side === 'player') {
      this.store.dispatch('battle/select', { unitId: unitAt.id })
      this.refreshViews()
      return
    }
    if (battleReachableArea(current, state).some((h) => hexKey(h) === hexKey(hex))) {
      const path = battleFindPath(current, hex, this.state) ?? [hex]
      this.store.dispatch('battle/move', { unitId: current.id, to: hex })
      void this.animateMove(current.id, path)
      this.refreshViews()
      return
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

  /** 逐格移动动画耗时（ms）；0 = 瞬间完成（e2e 用） */
  setAnimationSpeed(ms: number): void {
    this.animationMs = ms
  }

  /** 移动动画结束后 resolve；无动画立即 resolve */
  waitForMove(): Promise<void> {
    if (!this.animActive && this.animQueue.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.moveWaiter = resolve
    })
  }

  // ---------- 移动动画 ----------

  private animateMove(unitId: string, path: Axial[]): Promise<void> {
    if (this.animationMs <= 0 || path.length === 0) return Promise.resolve()
    this.visualPos.set(unitId, path[0] as Axial)
    return new Promise((resolve) => {
      this.animQueue.push({ unitId, path, resolve })
    })
  }

  private startNextAnim(): void {
    const item = this.animQueue.shift()
    if (!item) return
    this.animActive = { unitId: item.unitId, path: item.path, idx: 0, acc: 0, resolve: item.resolve }
    this.visualPos.set(item.unitId, item.path[0] as Axial)
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
          this.visualPos.delete(done.unitId)
          this.animActive = null
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
      hover: {
        ghostHex: this.hover.ghostHex,
        swordHex: this.hover.swordHex,
        cursorKind: this.hover.cursorKind,
        swordTargetId: this.hover.swordTargetId,
        blinkId: this.hover.blinkId
      },
      infoPanelText: this.infoPanel && this.infoPanel.visible ? this.infoPanel.text : null,
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
