import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { gameReducer } from '../core/state/reducer'
import { createInitialState, type GameState } from '../core/state/GameState'
import { generateMap } from '../core/map/MapGen'
import { hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { findPath, reachableArea } from '../core/pathfinding/Pathfinding'
import { MapMovementCost } from '../core/pathfinding/MapMovementCost'
import { getTerrain } from '../data/terrain'
import { RESOURCE_NODE_DEFS } from '../data/resourceNode'
import { BgmManager } from '../audio/BgmManager'
import { SfxManager } from '../audio/SfxManager'
import { weekOf } from '../core/state/GameState'
import {
  HERO_FACTION,
  HERO_GENERAL_ID,
  HERO_START,
  START_FACTIONS,
  START_GENERALS,
  START_TOWNS,
  TURN_ORDER
} from '../data/bootstrap'
import type { FactionId } from '../core/state/GameState'

/** 势力显示颜色（渲染层专用）：魏红 蜀绿 吴蓝 群紫 */
const FACTION_COLORS: Record<FactionId, number> = {
  wei: 0xcc3333,
  shu: 0x33aa44,
  wu: 0x3366cc,
  qun: 0x8844aa
}

/** 资源点图标颜色（渲染层专用） */
const NODE_COLORS: Record<string, number> = {
  woodMine: 0x8b5a2b,
  stoneMine: 0x9aa0a6,
  ironMine: 0xb0bec5,
  chest: 0xd4af37
}

/**
 * 大地图场景（渲染层）。
 * 职责：读 core 状态并渲染、把输入转成 core 动作（单向依赖：渲染可 import core，core 不可 import 渲染）。
 * 确定性：一切游戏状态（含迷雾、移动力）经 CommandLog 由 core reducer 驱动；
 * 渲染层只持有「动画中的临时位置」与「悬停高亮」这类纯视觉状态。
 *
 * 交互：
 * - 拖拽平移相机 / 滚轮缩放
 * - 悬停格子 → A* 路径高亮（仅限当前可达的可见格）
 * - 点击可达的可见格 → 逐格移动动画，每步 dispatch unit/move，走完后迷雾逐步揭开、
 *   若还有移动力可继续走（不可走出可见范围——由 core 校验保证）
 */
export class AdventureScene extends Phaser.Scene {
  static readonly KEY = 'Adventure'

  private seed = 42
  private readonly mapRadius = 6
  private readonly layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })

  private store!: CommandLog<GameState>
  /** BGM 背景音乐（渲染层；首次交互后随机起播，默认 10% 音量） */
  private bgm: BgmManager | null = null
  /** 音效（渲染层；移动时循环播放脚步，移动结束停止） */
  private sfx: SfxManager | null = null
  /** 移动脚步音效的缓存 key（= assets/sound/hero move.wav 的文件名去扩展名） */
  private readonly moveSfxKey = 'hero move'
  private mapGraphics!: Phaser.GameObjects.Graphics
  private fogGraphics!: Phaser.GameObjects.Graphics
  private nodeGraphics!: Phaser.GameObjects.Graphics
  private townGraphics!: Phaser.GameObjects.Graphics
  private overlayGraphics!: Phaser.GameObjects.Graphics
  private heroSprite!: Phaser.GameObjects.Graphics
  /** 顶部 HUD：资源条 + 日期 */
  private hudText!: Phaser.GameObjects.Text
  /** 城池详情 tag（点击城池格显示） */
  private townDetailText!: Phaser.GameObjects.Text
  /** 结束回合按钮 */
  private endTurnButton!: Phaser.GameObjects.Text

  /** 逐格移动动画耗时（ms）；0 = 瞬间完成（e2e 用） */
  private animationMs = 150

  /** 地图 hex 键集合（悬停/点击命中判断） */
  private mapKeys: Set<string> = new Set()
  /** 当前可达范围（hero 位置 / 移动力 / 迷雾 变化时经 computeReachable 重算） */
  private reachable: Set<string> = new Set()
  /** 当前悬停格（路径高亮用；null = 不在地图上） */
  private hoverHex: Axial | null = null

  /** 拖拽 / 点击判定 */
  private dragging = false
  private downPos = { x: 0, y: 0 }
  private lastPointer = { x: 0, y: 0 }
  /** 移动动画播放中（屏蔽输入） */
  private busy = false

  constructor() {
    super(AdventureScene.KEY)
  }

  create(): void {
    this.createLayers()
    this.buildStore()
    this.refreshViews()
    this.setupInput()
    // 地图中心（世界原点）居中到屏幕中心。视口 1920×1080 → scroll(-960,-540)
    this.cameras.main.centerOn(0, 0)
    // 音频：异步加载（不阻塞开局渲染）；BGM 首次交互后随机起播，音效随移动循环
    this.bgm = new BgmManager(this)
    void this.bgm.load()
    this.sfx = new SfxManager(this)
    void this.sfx.load()
    // E 键结束回合（与右下角按钮等效）
    this.input.keyboard?.on('keydown-E', () => this.endTurn())
  }

  /** 结束回合：dispatch game/advanceTurn，推进到下一势力（跨周自动结算） */
  private endTurn(): void {
    if (this.busy) return
    this.store.dispatch('game/advanceTurn')
    this.refreshViews()
  }

  // ---------- 生命周期 / 重建 ----------

  private get state(): GameState {
    return this.store.getState()
  }

  /** 新建 CommandLog 并 dispatch game/setup（用种子生成确定性地图） */
  private buildStore(): void {
    this.store = new CommandLog<GameState>(createInitialState(), gameReducer)
    const map = generateMap(this.seed, this.mapRadius)
    this.store.dispatch('game/setup', {
      turnOrder: [...TURN_ORDER],
      factions: START_FACTIONS.map((f) => ({ ...f })),
      generals: START_GENERALS.map((g) => ({ ...g })),
      towns: START_TOWNS.map((t) => ({ ...t })),
      map,
      mapSeed: this.seed,
      heroStart: HERO_START,
      heroGeneralId: HERO_GENERAL_ID,
      heroFaction: HERO_FACTION
    })
    this.mapKeys = new Set(this.state.map?.hexes.map(hexKey) ?? [])
    this.drawMap()
    this.drawTowns()
    this.drawNodes()
  }

  /** 重建游戏（dev：换种子重开） */
  setSeed(seed: number): void {
    this.seed = seed
    this.hoverHex = null
    this.busy = false
    // 重建（dev 换种子）时若恰在移动，停止脚步循环音效
    this.sfx?.stopLooped()
    this.buildStore()
    this.refreshViews()
    this.cameras.main.centerOn(0, 0)
  }

  /** 设置逐格移动动画耗时；0 = 瞬间完成 */
  setAnimationSpeed(ms: number): void {
    this.animationMs = Math.max(0, ms)
  }

  /** 设置 BGM 音量（0~1）；dev bridge / 未来"设置"界面用 */
  setBgmVolume(v: number): void {
    this.bgm?.setVolume(v)
  }

  /** 设置音效音量（0~1）；dev bridge / 未来"设置"界面用 */
  setSfxVolume(v: number): void {
    this.sfx?.setVolume(v)
  }

  /** 等待移动动画结束（供 e2e 轮询） */
  async waitForMove(): Promise<void> {
    while (this.busy) {
      await new Promise((r) => setTimeout(r, 16))
    }
  }

  // ---------- 渲染 ----------

  private createLayers(): void {
    this.mapGraphics = this.add.graphics().setDepth(0)
    this.fogGraphics = this.add.graphics().setDepth(1)
    this.nodeGraphics = this.add.graphics().setDepth(2)
    this.townGraphics = this.add.graphics().setDepth(2)
    this.overlayGraphics = this.add.graphics().setDepth(3)
    this.heroSprite = this.add.graphics().setDepth(4)
    // hero 精灵绘制在局部原点（0,0），位置由 syncHeroSprite 按核心坐标设置
    this.heroSprite.fillStyle(0xffd166, 1)
    this.heroSprite.fillCircle(0, 0, 10)
    this.heroSprite.lineStyle(2, 0xffffff, 1)
    this.heroSprite.strokeCircle(0, 0, 10)
    // 顶部 HUD：资源条 + 日期（固定视口坐标，非世界坐标）
    this.hudText = this.add
      .text(16, 10, '', {
        fontFamily: 'sans-serif',
        fontSize: '22px',
        color: '#f5f2e8'
      })
      .setDepth(10)
      .setScrollFactor(0)
    // 城池详情 tag（默认隐藏）
    this.townDetailText = this.add
      .text(0, 0, '', {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.65)'
      })
      .setDepth(11)
      .setScrollFactor(0)
      .setVisible(false)
    // 结束回合按钮（右下角，视口固定）
    this.endTurnButton = this.add
      .text(1920 - 140, 1080 - 56, '结束回合 [E]', {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)
      .setInteractive({ useHandCursor: true })
    this.endTurnButton.on('pointerdown', () => this.endTurn())
  }

  /** 读 core 状态重绘地形（setup/重建后调用一次） */
  private drawMap(): void {
    this.mapGraphics.clear()
    const map = this.state.map
    if (!map) return
    for (const hex of map.hexes) {
      const terrain = getTerrain(map.terrain[hexKey(hex)] ?? 'plain')
      const points: Phaser.Math.Vector2[] = []
      for (let c = 0; c < 6; c++) {
        const p = this.layout.cornerAt(hex, c)
        points.push(new Phaser.Math.Vector2(p.x, p.y))
      }
      this.mapGraphics.fillStyle(terrain.color, 1)
      this.mapGraphics.fillPoints(points, true)
      this.mapGraphics.lineStyle(1, 0x0b0f18, 1)
      this.mapGraphics.strokePoints(points, true)
    }
  }

  /** 迷雾两态覆盖：未探索全黑；已探索永久全亮可见（不遮） */
  private drawFog(): void {
    this.fogGraphics.clear()
    const map = this.state.map
    const hero = this.state.hero
    if (!map || !hero) return
    const fog = this.state.visibility[hero.faction] ?? {}
    for (const hex of map.hexes) {
      const v = fog[hexKey(hex)]
      if (v !== 'unexplored') continue
      this.fillHex(this.fogGraphics, hex, 0x000000, 1)
    }
  }

  /** 城池渲染：方块按归属色填充，叠在 hero 之下 */
  private drawTowns(): void {
    this.townGraphics.clear()
    for (const town of this.state.towns) {
      const c = this.layout.hexToPixel(town.position)
      const color = FACTION_COLORS[town.owner]
      this.townGraphics.fillStyle(color, 1)
      // 方块比 hero 圆点略大，叠在 (0,0) 时从 hero 底部露出来
      this.townGraphics.fillRect(c.x - 14, c.y - 14, 28, 28)
      this.townGraphics.lineStyle(2, 0xffffff, 1)
      this.townGraphics.strokeRect(c.x - 14, c.y - 14, 28, 28)
    }
  }

  /** 资源点渲染：矿/宝箱按类型着色圆点；已拾取宝箱变暗、已占矿描边 */
  private drawNodes(): void {
    this.nodeGraphics.clear()
    const map = this.state.map
    if (!map) return
    for (const [k, type] of Object.entries(map.nodes ?? {})) {
      const node = this.state.nodeStates[k]
      if (!node) continue
      const hex = this.parseKey(k)
      if (!hex) continue
      const c = this.layout.hexToPixel(hex)
      const def = RESOURCE_NODE_DEFS[type]
      const isMineType = Boolean(def.weeklyBonus)
      // 矿：方块；宝箱：菱形。已拾取宝箱整体变暗
      const base = NODE_COLORS[type] ?? 0xffffff
      const claimed = node.owner !== null
      const dimmed = !isMineType && node.visited
      const color = dimmed ? 0x555555 : base
      this.nodeGraphics.fillStyle(color, 1)
      if (isMineType) {
        this.nodeGraphics.fillRect(c.x - 8, c.y - 8, 16, 16)
      } else {
        this.nodeGraphics.fillPoints(
          [
            new Phaser.Math.Vector2(c.x, c.y - 10),
            new Phaser.Math.Vector2(c.x + 10, c.y),
            new Phaser.Math.Vector2(c.x, c.y + 10),
            new Phaser.Math.Vector2(c.x - 10, c.y)
          ],
          true
        )
      }
      // 已占矿：白边
      if (isMineType && claimed) {
        this.nodeGraphics.lineStyle(2, 0xffffff, 1)
        this.nodeGraphics.strokeRect(c.x - 8, c.y - 8, 16, 16)
      }
    }
  }

  /** 顶部 HUD：金/木/石/铁 + 第X周第X天（视口固定） */
  private updateHud(): void {
    const state = this.state
    if (!state.hero) return
    const r = state.resources[state.hero.faction]
    this.hudText.setText(
      `金: ${r.gold}   木: ${r.wood}   石: ${r.stone}   铁: ${r.iron}    第${weekOf(state.turn)}周第${state.turn}天`
    )
  }

  /** hexKey → Axial（渲染层命中/解析用；无法解析返回 null） */
  private parseKey(k: string): Axial | null {
    const m = /^(-?\d+),(-?\d+)$/.exec(k)
    if (!m) return null
    return { q: Number(m[1]), r: Number(m[2]) }
  }

  /** 悬停格路径高亮（淡黄）；不再高亮可达范围 */
  private drawOverlay(): void {
    this.overlayGraphics.clear()
    const hero = this.state.hero
    if (!hero) return
    if (this.hoverHex && this.reachable.has(hexKey(this.hoverHex))) {
      const path = findPath(hero.position, this.hoverHex, this.makeMapCosts())
      if (path) {
        for (const h of path) this.fillHex(this.overlayGraphics, h, 0xfff2b3, 0.4)
      }
    }
  }

  /** hero 精灵对齐 core 坐标 */
  private syncHeroSprite(): void {
    const hero = this.state.hero
    if (!hero) return
    const c = this.layout.hexToPixel(hero.position)
    this.heroSprite.setPosition(c.x, c.y)
  }

  /** 状态变化后统一刷新：迷雾 + 资源点 + 城池 + 可达 + 高亮 + hero 位置 + HUD */
  private refreshViews(): void {
    this.drawFog()
    this.drawNodes()
    this.drawTowns()
    this.computeReachable()
    this.drawOverlay()
    this.syncHeroSprite()
    this.updateHud()
  }

  /** 在指定 Graphics 上画一个填充六角格 */
  private fillHex(g: Phaser.GameObjects.Graphics, hex: Axial, color: number, alpha: number): void {
    const points: Phaser.Math.Vector2[] = []
    for (let c = 0; c < 6; c++) {
      const p = this.layout.cornerAt(hex, c)
      points.push(new Phaser.Math.Vector2(p.x, p.y))
    }
    g.fillStyle(color, alpha)
    g.fillPoints(points, true)
  }

  // ---------- 寻路 / 状态查询 ----------

  /** 地形 × 迷雾 的寻路代价（只允许走进当前可见格） */
  private makeMapCosts(): MapMovementCost {
    const map = this.state.map
    const hero = this.state.hero
    if (!map || !hero) throw new Error('map/hero 未就绪')
    return new MapMovementCost({
      terrainAt: (h) => map.terrain[hexKey(h)] ?? 'plain',
      fogAt: (h) => this.state.visibility[hero.faction]?.[hexKey(h)]
    })
  }

  private computeReachable(): void {
    const hero = this.state.hero
    if (!hero || !this.state.map) {
      this.reachable = new Set()
      return
    }
    this.reachable = new Set(reachableArea(hero.position, hero.movementLeft, this.makeMapCosts()).map(hexKey))
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    const cam = this.cameras.main
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true
      this.downPos = { x: p.x, y: p.y }
      this.lastPointer = { x: p.x, y: p.y }
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) {
        const dx = (p.x - this.lastPointer.x) / cam.zoom
        const dy = (p.y - this.lastPointer.y) / cam.zoom
        cam.scrollX -= dx
        cam.scrollY -= dy
        this.lastPointer = { x: p.x, y: p.y }
        return
      }
      this.updateHover(p)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false
      // 位移过小视为点击（而非拖拽平移）
      const moved = Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y)
      if (moved > 6 || this.busy) return
      this.handleClick(p)
    })
    this.input.on('pointerupoutside', () => {
      this.dragging = false
    })
    this.input.on('wheel', (pointer: Phaser.Input.Pointer) => {
      const zoom = Phaser.Math.Clamp(cam.zoom - (pointer.deltaY ?? 0) * 0.001, 0.4, 2)
      cam.setZoom(zoom)
    })
  }

  private updateHover(p: Phaser.Input.Pointer): void {
    if (this.busy) return
    const world = this.cameras.main.getWorldPoint(p.x, p.y)
    const hex = this.layout.pixelToHex(world.x, world.y)
    const inMap = this.mapKeys.has(hexKey(hex))
    const curKey = this.hoverHex ? hexKey(this.hoverHex) : null
    if (curKey === (inMap ? hexKey(hex) : null)) return
    this.hoverHex = inMap ? hex : null
    this.drawOverlay()
  }

  private handleClick(p: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(p.x, p.y)
    const hex = this.layout.pixelToHex(world.x, world.y)
    const hero = this.state.hero
    // 点击城池格：显示城池详情（不触发移动）
    const town = this.state.towns.find((t) => hexKey(t.position) === hexKey(hex))
    if (town) {
      this.showTownDetail(town, p)
      return
    }
    this.hideTownDetail()
    if (!hero || !this.mapKeys.has(hexKey(hex))) return
    if (!this.reachable.has(hexKey(hex))) return
    const path = findPath(hero.position, hex, this.makeMapCosts())
    if (!path || path.length < 2) return
    void this.animateMove(path)
  }

  /** 显示城池详情 tag（点击城池格时） */
  private showTownDetail(
    town: { id: string; name: string; owner: FactionId; level: number; garrisonGeneralId: string | null },
    pointer: Phaser.Input.Pointer
  ): void {
    const ownerName: Record<FactionId, string> = { wei: '魏', shu: '蜀', wu: '吴', qun: '群' }
    const garrison = town.garrisonGeneralId
      ? this.state.generals.find((g) => g.id === town.garrisonGeneralId)?.name ?? ''
      : ''
    this.townDetailText.setText(
      `${town.name}  Lv${town.level}  势力:${ownerName[town.owner]}${garrison ? `  驻将:${garrison}` : ''}`
    )
    // tag 跟随点击位置，视口坐标
    this.townDetailText.setPosition(pointer.x + 12, pointer.y - 8)
    this.townDetailText.setVisible(true)
  }

  private hideTownDetail(): void {
    this.townDetailText.setVisible(false)
  }

  /** 沿路径逐格移动：dispatch unit/move → tween 到位 → 刷新迷雾（揭开新地形） */
  private async animateMove(path: Axial[]): Promise<void> {
    this.busy = true
    this.sfx?.playLooped(this.moveSfxKey)
    this.hoverHex = null
    this.drawOverlay()
    try {
      for (let i = 1; i < path.length; i++) {
        const to = path[i]
        const before = this.state.hero?.position
        this.store.dispatch('unit/move', { to })
        const after = this.state.hero?.position
        // reducer 拒绝（移动力耗尽 / 地形/迷雾校验不过）则停止
        if (!before || !after || hexKey(after) === hexKey(before)) break
        if (this.animationMs > 0) {
          await this.tweenHeroTo(after)
        } else {
          this.syncHeroSprite()
        }
        // 到达该格后：迷雾揭开（computeVision 已更新）→ 可达范围随新视野重算
        this.refreshViews()
      }
    } finally {
      this.busy = false
      // 移动结束（含被 reducer 拒绝/动画中断）：必须停掉脚步循环音效
      this.sfx?.stopLooped()
    }
  }

  private tweenHeroTo(hex: Axial): Promise<void> {
    const target = this.layout.hexToPixel(hex)
    return new Promise((resolve) => {
      this.tweens.add({
        targets: this.heroSprite,
        x: target.x,
        y: target.y,
        duration: this.animationMs,
        ease: 'Linear',
        onComplete: () => resolve()
      })
    })
  }

  // ---------- dev 调试句柄 / e2e ----------

  getDebugState(): Record<string, unknown> {
    const state = this.state
    const fog = state.hero ? (state.visibility[state.hero.faction] ?? {}) : {}
    const counts = { explored: 0, unexplored: 0 }
    for (const v of Object.values(fog)) counts[v]++
    return {
      ready: !!state.map,
      hexesRendered: state.map?.hexes.length ?? 0,
      seed: this.seed,
      resolution: { width: this.scale.width, height: this.scale.height },
      camera: {
        x: Math.round(this.cameras.main.scrollX),
        y: Math.round(this.cameras.main.scrollY),
        zoom: Math.round(this.cameras.main.zoom * 100) / 100
      },
      turn: state.turn,
      week: weekOf(state.turn),
      currentFaction: state.currentFaction,
      hero: state.hero
        ? {
            position: state.hero.position,
            movementLeft: state.hero.movementLeft,
            maxMovement: state.hero.maxMovement
          }
        : null,
      resources: state.hero ? state.resources[state.hero.faction] : null,
      towns: state.towns.map((t) => ({ id: t.id, name: t.name, owner: t.owner, level: t.level, position: t.position })),
      nodeStates: {
        picked: Object.values(state.nodeStates).filter((n) => n.visited).length,
        claimedMines: Object.values(state.nodeStates).filter((n) => n.owner !== null).length
      },
      visibility: counts,
      busy: this.busy,
      bgm: this.bgm ? this.bgm.getState() : null,
      sfx: this.sfx ? this.sfx.getState() : null
    }
  }
}
