import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { gameReducer } from '../core/state/reducer'
import {
  computeDailyIncome,
  createInitialState,
  weekOf,
  type FactionId,
  type GameState,
  type Resources
} from '../core/state/GameState'
import { generateMap } from '../core/map/MapGen'
import { hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { findPath, reachableArea } from '../core/pathfinding/Pathfinding'
import { MapMovementCost } from '../core/pathfinding/MapMovementCost'
import { getTerrain } from '../data/terrain'
import { RESOURCE_NODE_DEFS } from '../data/resourceNode'
import { BgmManager } from '../audio/BgmManager'
import { SfxManager } from '../audio/SfxManager'
import {
  HERO_FACTION,
  HERO_GENERAL_ID,
  HERO_START,
  START_FACTIONS,
  START_GENERALS,
  START_TOWNS,
  TURN_ORDER
} from '../data/bootstrap'

/** 势力显示颜色（渲染层专用）：魏红 蜀绿 吴蓝 群紫 */
const FACTION_COLORS: Record<FactionId, number> = {
  wei: 0xcc3333,
  shu: 0x33aa44,
  wu: 0x3366cc,
  qun: 0x8844aa
}

/** 资源点图标 key（渲染层专用；Kenney CC0，见 assets/icons/README.md） */
const NODE_ICON_KEYS: Record<string, string> = {
  woodMine: 'icon-wood',
  stoneMine: 'icon-stone',
  ironMine: 'icon-iron',
  chest: 'icon-gold'
}

/** 资源图标代表色（渲染层专用；Kenney 图标为纯白剪影，用 setTint 上色）：
 *  金=亮金、木=棕、石=灰、铁=银蓝。HUD 与地图资源点共用。 */
const RESOURCE_COLORS = {
  gold: 0xffd166,
  wood: 0xb07a3f,
  stone: 0x9aa0a8,
  iron: 0x9fb4c7
} as const

/** 资源点类型的代表色（chest 用金色；矿分别用木/石/铁色） */
const NODE_COLORS: Record<string, number> = {
  woodMine: RESOURCE_COLORS.wood,
  stoneMine: RESOURCE_COLORS.stone,
  ironMine: RESOURCE_COLORS.iron,
  chest: RESOURCE_COLORS.gold
}

/** 资源键 → 中文名（tooltip / 日志用；与 core 的 Resources 字段一致） */
const RESOURCE_NAMES: Record<keyof import('../core/state/GameState').Resources, string> = {
  gold: '金',
  wood: '木',
  stone: '石',
  iron: '铁'
}

/** 图标 URL（Vite 构建期自动发现 assets/icons/*.png；新增图标无需改代码） */
const ICON_URLS = import.meta.glob('/assets/icons/*.png', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>

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
  /** 顶部 HUD：资源条（图标 + 数值(+每日产出)）+ 日期 */
  private hudResourceCols!: { resource: keyof Resources; icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }[]
  private hudDateText!: Phaser.GameObjects.Text
  /** HUD 悬停提示：`金 +10/天（成都 Lv1）+2/天（伐木场）` */
  private hudTooltip!: Phaser.GameObjects.Text
  /** HUD 资源列（图标 key → 资源键）与产出来源明细（悬停用） */
  private hudIncomeDetail!: Record<keyof Resources, string[]>
  /** 资源点图标 sprite（hexKey → image；随迷雾探索创建、重建清理） */
  private nodeSprites = new Map<string, Phaser.GameObjects.Image>()
  /** 城池图标 sprite（town.id → image） */
  private townSprites = new Map<string, Phaser.GameObjects.Image>()
  /** 城池详情 tag（点击城池格显示） */
  private townDetailText!: Phaser.GameObjects.Text
  /** 资源点详情 tag（悬停资源点显示：名称 + 每日产出/一次性 + 状态） */
  private nodeDetailText!: Phaser.GameObjects.Text
  /** 结束回合按钮 */
  private endTurnButton!: Phaser.GameObjects.Text
  /** BGM 播放控件：上一首 */
  private bgmPrevBtn!: Phaser.GameObjects.Text
  /** BGM 播放控件：曲目名 */
  private bgmLabel!: Phaser.GameObjects.Text
  /** BGM 播放控件：下一首 */
  private bgmNextBtn!: Phaser.GameObjects.Text
  /** BGM 播放控件：音量按钮 */
  private bgmVolumeBtn!: Phaser.GameObjects.Text
  /** BGM 音量滑块（单 Graphics：轨道 + 填充 + 手柄指示器） */
  private bgmSlider!: Phaser.GameObjects.Graphics
  /** 音量滑块是否可见 */
  private bgmSliderVisible = false
  /** 是否正在拖拽滑块 */
  private bgmSliderDragging = false
  /** 滑块总宽度（px） */
  private static readonly SLIDER_W = 120
  /** 滑块轨道高度（px） */
  private static readonly SLIDER_H = 8

  /**
   * 视口分区（从上到下）：HUD → Map → Tools。
   * 地图交互（拖拽/点击/悬停）仅在 Map 区生效，避免与 HUD / 底部工具栏冲突。
   */
  /** 顶部 HUD 保留高度（px） */
  private static readonly HUD_H = 48
  /** 底部工具栏保留高度（px）：BGM 控件 + 结束回合按钮 */
  private static readonly TOOLS_H = 72

  /** 屏幕 Y 坐标是否在地图交互区内 */
  private isInMapZone(screenY: number): boolean {
    return screenY >= AdventureScene.HUD_H && screenY < this.cameras.main.height - AdventureScene.TOOLS_H
  }

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

  /** 预加载资源图标（Kenney CC0，assets/icons/）；key = 文件名去扩展名 */
  preload(): void {
    for (const [path, url] of Object.entries(ICON_URLS)) {
      const file = path.split('/').pop()
      if (!file) continue
      const key = file.replace(/\.png$/, '')
      this.load.image(key, url)
    }
  }

  create(): void {
    // BGM 管理器先创建（createLayers 中 BGM 控件依赖它）
    this.bgm = new BgmManager(this)
    this.createLayers()
    // 控件在 createLayers 中 inline 创建；此处补设切歌回调
    this.bgm.setTrackChangeCallback(() => this.refreshBgmLabel())
    this.buildStore()
    this.refreshViews()
    this.setupInput()
    // 地图中心（世界原点）居中到屏幕中心。视口 1920×1080 → scroll(-960,-540)
    this.cameras.main.centerOn(0, 0)
    // 音频异步加载；加载完成后切到探索 BGM playlist
    void this.bgm.load().then(() => this.bgm?.switchToCategory('explore'))
    this.sfx = new SfxManager(this)
    void this.sfx.load()
    // E 键结束回合（与右下角按钮等效）
    this.input.keyboard?.on('keydown-E', () => this.endTurn())
    // 窗口大小变化时重新排布底部控件
    this.scale.on('resize', () => this.repositionBottomControls())
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

  /** 刷新 BGM 播放控件标签（切歌 / 播放/停止时调用） */
  private refreshBgmLabel(): void {
    if (!this.bgm || !this.bgmLabel) return
    const track = this.bgm.getCurrentTrack()
    const playing = this.bgm.getState().playing
    // 音符 + 空格 + 曲名
    this.bgmLabel.setText(track && playing ? `\u{266A} ${track}` : '')
    // 流式重排：prev → label → next → volume
    this.bgmLabel.setX(this.bgmPrevBtn.x + this.bgmPrevBtn.width + 6)
    this.bgmNextBtn.setX(this.bgmLabel.x + this.bgmLabel.width + 6)
    this.bgmVolumeBtn.setX(this.bgmNextBtn.x + this.bgmNextBtn.width + 6)
  }

  // ---------- 音量滑块 ----------

  /** 音量图标：按当前音量选 emoji（🔇 零 / 🔈 低 / 🔉 中 / 🔊 高） */
  private updateVolumeIcon(): void {
    const v = this.bgm?.getVolume() ?? 0
    if (v <= 0) this.bgmVolumeBtn.setText('\u{1F507}')       // 🔇
    else if (v <= 0.33) this.bgmVolumeBtn.setText('\u{1F508}') // 🔈
    else if (v <= 0.66) this.bgmVolumeBtn.setText('\u{1F509}') // 🔉
    else this.bgmVolumeBtn.setText('\u{1F50A}')                // 🔊
  }

  /** 切换音量滑块显隐 */
  private toggleBgmSlider(): void {
    this.bgmSliderVisible = !this.bgmSliderVisible
    if (this.bgmSliderVisible) {
      this.showBgmSlider()
    } else {
      this.hideBgmSlider()
    }
  }

  /** 显示滑块并绘制当前音量 */
  private showBgmSlider(): void {
    // 滑块定位在音量按钮右侧，垂直居中
    const sliderX = this.bgmVolumeBtn.x + this.bgmVolumeBtn.width + 8
    const sliderY = this.bgmVolumeBtn.y + 12
    this.bgmSlider.setPosition(sliderX, sliderY).setVisible(true)
    // 交互：pointerdown 开始拖拽/点击 → pointermove 更新 → pointerup 结束
    const hitArea = new Phaser.Geom.Rectangle(0, -8, AdventureScene.SLIDER_W, AdventureScene.SLIDER_H + 16)
    this.bgmSlider.setInteractive({ hitArea, hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true })
    this.bgmSlider.on('pointerdown', this.bgmSliderDownHandler)
    this.input.on('pointermove', this.bgmSliderMoveHandler)
    this.input.on('pointerup', this.bgmSliderUpHandler)
    this.input.on('pointerupoutside', this.bgmSliderUpHandler)
    this.drawBgmSlider()
  }

  /** 隐藏滑块并解绑交互 */
  private hideBgmSlider(): void {
    this.bgmSlider.setVisible(false)
    this.bgmSliderDragging = false
    this.bgmSlider.removeInteractive()
    this.bgmSlider.off('pointerdown', this.bgmSliderDownHandler)
    this.input.off('pointermove', this.bgmSliderMoveHandler)
    this.input.off('pointerup', this.bgmSliderUpHandler)
    this.input.off('pointerupoutside', this.bgmSliderUpHandler)
  }

  /** pointerdown 在滑块上：立即更新音量 + 开始拖拽 */
  private readonly bgmSliderDownHandler = (pointer: Phaser.Input.Pointer): void => {
    this.bgmSliderDragging = true
    this.updateSliderFromPointer(pointer)
  }

  private readonly bgmSliderUpHandler = (): void => { this.bgmSliderDragging = false }

  /** pointermove：拖拽中则跟随指针更新音量 */
  private readonly bgmSliderMoveHandler = (pointer: Phaser.Input.Pointer): void => {
    if (!this.bgmSliderVisible || !this.bgmSliderDragging) return
    this.updateSliderFromPointer(pointer)
  }

  /**
   * 由指针计算滑块本地位置 → clamp → setVolume → 重绘。
   * scrollFactor(0) 对象的 .x 为屏幕坐标，pointer.x 也是屏幕坐标，直接相减即可。
   */
  private updateSliderFromPointer(pointer: Phaser.Input.Pointer): void {
    if (!this.bgm) return
    const localX = pointer.x - this.bgmSlider.x
    const vol = Phaser.Math.Clamp(localX / AdventureScene.SLIDER_W, 0, 1)
    this.bgm.setVolume(vol)
    this.drawBgmSlider()
    this.updateVolumeIcon()
  }

  /** 重绘滑块：轨道背景 + 已选填充 + 手柄圆点 */
  private drawBgmSlider(): void {
    const vol = this.bgm?.getVolume() ?? 0
    const W = AdventureScene.SLIDER_W
    const H = AdventureScene.SLIDER_H
    const fillW = Math.max(H, vol * W)

    const g = this.bgmSlider
    g.clear()
    // 轨道背景
    g.fillStyle(0x1a1f2e, 1)
    g.fillRoundedRect(0, 0, W, H, H / 2)
    // 已选填充
    g.fillStyle(0x5a7ab0, 1)
    g.fillRoundedRect(0, 0, fillW, H, H / 2)
    // 手柄圆点
    const hx = fillW
    const hy = H / 2
    g.fillStyle(0xffffff, 1)
    g.fillCircle(hx, hy, 7)
    g.lineStyle(1.5, 0x5a7ab0, 1)
    g.strokeCircle(hx, hy, 7)
  }

  /** 窗口 resize 时重新排布底部控件（结束回合按钮 + BGM 控件） */
  private repositionBottomControls(): void {
    const cam = this.cameras.main
    const y = cam.height - 56
    // 结束回合按钮：右下角
    this.endTurnButton.setPosition(cam.width - 140, y)
    // BGM 控件：左下角
    this.bgmPrevBtn.setY(y)
    this.bgmLabel.setY(y)
    this.bgmNextBtn.setY(y)
    this.bgmVolumeBtn.setY(y)
    // 滑块跟随音量按钮（右侧对齐，垂直居中）
    const sliderX = this.bgmVolumeBtn.x + this.bgmVolumeBtn.width + 8
    const sliderY = y + 12
    this.bgmSlider.setPosition(sliderX, sliderY)
    if (this.bgmSliderVisible) this.drawBgmSlider()
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
    // 顶部 HUD：资源条（图标 + 数值(+每日产出)）+ 日期（固定视口坐标，非世界坐标）。
    // 流式布局：每个资源列 = 图标紧跟其数值文本，按文本实际宽度自左向右排布；
    // 图标不做固定绝对定位（否则 (+N) 变长会与图标重叠），列宽由 updateHud 按实际内容推进。
    const hudStyle = { fontFamily: 'sans-serif', fontSize: '20px', color: '#f5f2e8' }
    const HUD_COLS: { key: string; resource: keyof Resources; tint: number }[] = [
      { key: 'icon-gold', resource: 'gold', tint: RESOURCE_COLORS.gold },
      { key: 'icon-wood', resource: 'wood', tint: RESOURCE_COLORS.wood },
      { key: 'icon-stone', resource: 'stone', tint: RESOURCE_COLORS.stone },
      { key: 'icon-iron', resource: 'iron', tint: RESOURCE_COLORS.iron }
    ]
    this.hudResourceCols = HUD_COLS.map((col) => {
      const icon = this.add
        .image(0, 24, col.key)
        .setDepth(10)
        .setScrollFactor(0)
        .setScale(22 / 64)
        .setTint(col.tint)
      icon.setInteractive({ useHandCursor: true })
      icon.on('pointerover', (p: Phaser.Input.Pointer) => this.showHudTooltip(col.resource, p))
      icon.on('pointerout', () => this.hideHudTooltip())
      const text = this.add.text(0, 24, '', hudStyle).setOrigin(0, 0.5).setDepth(10).setScrollFactor(0)
      text.setInteractive({ useHandCursor: true })
      text.on('pointerover', (p: Phaser.Input.Pointer) => this.showHudTooltip(col.resource, p))
      text.on('pointerout', () => this.hideHudTooltip())
      return { resource: col.resource, icon, text }
    })
    // HUD 悬停提示（默认隐藏；hover 资源图标/数值时显示产出来源明细）
    this.hudTooltip = this.add
      .text(0, 0, '', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.65)'
      })
      .setDepth(11)
      .setScrollFactor(0)
      .setVisible(false)
    // 供 hover 回调查找资源的产出来源（每帧 updateHud 刷新）
    this.hudIncomeDetail = { gold: [], wood: [], stone: [], iron: [] }
    this.hudDateText = this.add
      .text(404, 24, '', hudStyle)
      .setOrigin(0, 0.5)
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
    // 资源点详情 tag（默认隐藏；悬停资源点显示）
    this.nodeDetailText = this.add
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
    {
      const cam = this.cameras.main
      this.endTurnButton = this.add
        .text(cam.width - 140, cam.height - 56, '结束回合 [E]', {
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
    // BGM 播放控件（左下角，参照 endTurnButton 的样式）
    {
      const y = this.cameras.main.height - 56
      const btnStyle = { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' }
      const labelStyle = { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#1a1f2e' }

      this.bgmPrevBtn = this.add.text(16, y, '<', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true })
      this.bgmLabel = this.add.text(this.bgmPrevBtn.x + this.bgmPrevBtn.width + 6, y, '', labelStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8)
      this.bgmNextBtn = this.add.text(this.bgmLabel.x + this.bgmLabel.width + 6, y, '>', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true })
      this.bgmVolumeBtn = this.add.text(this.bgmNextBtn.x + this.bgmNextBtn.width + 6, y, '\u{1F50A}', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true })

      this.bgmPrevBtn.on('pointerdown', () => { this.bgm?.prevTrack(); this.refreshBgmLabel() })
      this.bgmNextBtn.on('pointerdown', () => { this.bgm?.nextTrack(); this.refreshBgmLabel() })
      this.bgmVolumeBtn.on('pointerdown', () => this.toggleBgmSlider())

      // 音量滑块：音量按钮右侧，垂直居中于按钮（单 Graphics 绘制全部：轨道 + 填充 + 手柄）
      const sliderY = y + 12
      this.bgmSlider = this.add.graphics().setPosition(0, sliderY).setDepth(13).setScrollFactor(0).setVisible(false)
    }
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

  /** 城池渲染：房屋图标按归属色 tint，叠在 hero 之下；未探索区域的城池不可见 */
  private drawTowns(): void {
    this.townGraphics.clear()
    const hero = this.state.hero
    if (!hero) return
    const fog = this.state.visibility[hero.faction] ?? {}
    const seen = new Set<string>()
    for (const town of this.state.towns) {
      if (fog[hexKey(town.position)] === 'unexplored') continue
      seen.add(town.id)
      const c = this.layout.hexToPixel(town.position)
      let sprite = this.townSprites.get(town.id)
      if (!sprite) {
        sprite = this.add.image(c.x, c.y, 'icon-town').setDepth(2).setScale(34 / 64)
        this.townSprites.set(town.id, sprite)
      }
      sprite.setPosition(c.x, c.y)
      // 归属色 tint：魏红 蜀绿 吴蓝 群紫
      sprite.setTint(FACTION_COLORS[town.owner])
    }
    // 重建（换种子）后清理已不存在城池的 sprite
    for (const id of this.townSprites.keys()) {
      if (!seen.has(id)) {
        this.townSprites.get(id)?.destroy()
        this.townSprites.delete(id)
      }
    }
  }

  /**
   * 资源点渲染：
   * - 矿（持续产出）：资源图标 + 深色六角底座（设施感）+ 已占归属色边框；
   * - 宝箱（一次性）：金色钱袋、无底座（散落物感），**拾取后从地图移除**（不再渲染；
   *   core 仍保留 visited=true 供回放/确定性判断，仅渲染层不画）；
   * - 未探索区域的资源点不可见。
   */
  private drawNodes(): void {
    this.nodeGraphics.clear()
    const map = this.state.map
    const hero = this.state.hero
    if (!map || !hero) return
    const fog = this.state.visibility[hero.faction] ?? {}
    const seen = new Set<string>()
    for (const [k, type] of Object.entries(map.nodes ?? {})) {
      // 未探索区域资源不可见（与迷雾两态一致；该格被探索后永久可见）
      if (fog[k] === 'unexplored') continue
      const node = this.state.nodeStates[k]
      if (!node) continue
      const hex = this.parseKey(k)
      if (!hex) continue
      const def = RESOURCE_NODE_DEFS[type]
      const isMineType = Boolean(def.dailyBonus)
      // 已拾取的宝箱：从大地图移除（continue → 不加入 seen → 尾部清理销毁其 sprite）
      if (!isMineType && node.visited) continue
      seen.add(k)
      const c = this.layout.hexToPixel(hex)
      const iconKey = NODE_ICON_KEYS[type] ?? 'icon-gold'
      const claimed = node.owner !== null
      // 矿：六角底座（比图标略大，深色半透明）→ 设施感；宝箱无底座
      if (isMineType) {
        this.fillHexScaled(this.nodeGraphics, hex, 0.62, 0x0b0f18, 0.55)
        this.nodeGraphics.lineStyle(2, claimed ? FACTION_COLORS[node.owner as FactionId] : 0xffffff, claimed ? 1 : 0.4)
        this.nodeGraphics.strokePoints(this.hexPoints(hex, 0.62), true)
      }
      let sprite = this.nodeSprites.get(k)
      if (!sprite) {
        sprite = this.add.image(c.x, c.y, iconKey).setDepth(2).setScale(24 / 64)
        this.nodeSprites.set(k, sprite)
      } else if (sprite.texture.key !== iconKey) {
        sprite.setTexture(iconKey)
      }
      sprite.setPosition(c.x, c.y)
      // 图标上色（Kenney 白剪影 setTint → 资源代表色）
      sprite.setTint(NODE_COLORS[type] ?? RESOURCE_COLORS.gold)
      sprite.setAlpha(1)
    }
    // 重建（换种子）后清理已不存在资源点的 sprite
    for (const k of this.nodeSprites.keys()) {
      if (!seen.has(k)) {
        this.nodeSprites.get(k)?.destroy()
        this.nodeSprites.delete(k)
      }
    }
  }

  /** 顶部 HUD：金/木/石/铁 图标+数值(+每日产出) + 第X周第X天（视口固定；流式布局自适应列宽） */
  private updateHud(): void {
    const state = this.state
    if (!state.hero) return
    const faction = state.hero.faction
    const r = state.resources[faction]
    // 当前势力的每日产出汇总（城池 + 已占矿）
    const income = computeDailyIncome(state, faction)
    // 流式排布：图标在左、数值文本紧随其后，按文本实际宽度推进游标（图标不固定绝对位置）
    const ICON_SIZE = 22
    const ICON_GAP = 6
    const COL_GAP = 24
    let cursorX = 16
    for (const col of this.hudResourceCols) {
      const suffix = income[col.resource] > 0 ? ` (+${income[col.resource]})` : ''
      col.text.setText(`${r[col.resource]}${suffix}`)
      // setText 后 text.width 立即更新；图标中心对齐文本左沿，两者随内容整体伸缩
      col.icon.setX(cursorX + ICON_SIZE / 2)
      col.text.setX(cursorX + ICON_SIZE + ICON_GAP)
      cursorX = col.text.x + col.text.width + COL_GAP
    }
    this.hudDateText.setX(cursorX - COL_GAP + 12)
    this.hudDateText.setText(`第${weekOf(state.turn)}周第${state.turn}天`)
    // 刷新产出来源明细（hover tooltip 用）：金 → `成都 Lv1 +10`；矿 → `伐木场 +2`
    const detail: Record<keyof Resources, string[]> = { gold: [], wood: [], stone: [], iron: [] }
    for (const town of state.towns) {
      if (town.owner !== faction) continue
      detail.gold.push(`${town.name} Lv${town.level} +${town.level * 10}`)
    }
    for (const [k, nodeState] of Object.entries(state.nodeStates)) {
      if (nodeState.owner !== faction) continue
      const type = state.map?.nodes?.[k]
      if (!type || !RESOURCE_NODE_DEFS[type].dailyBonus) continue
      const bonus = RESOURCE_NODE_DEFS[type].dailyBonus
      for (const [resKey, v] of Object.entries(bonus)) {
        const rk = resKey as keyof Resources
        if (v > 0) detail[rk].push(`${RESOURCE_NODE_DEFS[type].name} +${v}`)
      }
    }
    this.hudIncomeDetail = detail
  }

  /** 悬停 HUD 资源列 → tooltip：`金 +10/天：成都 Lv1 +10`；无产出则提示无来源 */
  private showHudTooltip(resource: keyof Resources, pointer: Phaser.Input.Pointer): void {
    const lines = this.hudIncomeDetail?.[resource] ?? []
    if (lines.length === 0) {
      this.hudTooltip.setText(`${RESOURCE_NAMES[resource]}：当前无每日产出`)
    } else {
      this.hudTooltip.setText(`${RESOURCE_NAMES[resource]} 每日产出：${lines.join('，')}`)
    }
    this.hudTooltip.setPosition(pointer.x + 12, pointer.y - 8)
    this.hudTooltip.setVisible(true)
  }

  private hideHudTooltip(): void {
    this.hudTooltip.setVisible(false)
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

  /** 六角格的 6 角点，按比例缩放（scale=1 即原格；<1 缩到中心，用于矿底座） */
  private hexPoints(hex: Axial, scale: number): Phaser.Math.Vector2[] {
    const center = this.layout.hexToPixel(hex)
    const points: Phaser.Math.Vector2[] = []
    for (let c = 0; c < 6; c++) {
      const p = this.layout.cornerAt(hex, c)
      points.push(new Phaser.Math.Vector2(center.x + (p.x - center.x) * scale, center.y + (p.y - center.y) * scale))
    }
    return points
  }

  /** 在指定 Graphics 上画一个缩小比例的填充六角格（矿底座用） */
  private fillHexScaled(g: Phaser.GameObjects.Graphics, hex: Axial, scale: number, color: number, alpha: number): void {
    g.fillStyle(color, alpha)
    g.fillPoints(this.hexPoints(hex, scale), true)
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
      // 仅在 Map 区启动拖拽；HUD / 工具栏区不触发地图交互
      if (!this.isInMapZone(p.y)) return
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
      if (this.isInMapZone(p.y)) this.updateHover(p)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false
      // 仅在 Map 区处理点击；位移过小视为点击（而非拖拽平移）
      if (!this.isInMapZone(p.y)) return
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
    // 悬停资源点 → 显示详情 tooltip（名称 + 每日产出/一次性 + 状态）
    this.updateNodeTooltip(p, inMap ? hex : null)
  }

  /** 悬停资源点 → tooltip：`名称  每日产出 +N木（已占领）` / `名称  一次性 +30金 +5木` */
  private updateNodeTooltip(pointer: Phaser.Input.Pointer, hex: Axial | null): void {
    this.hideNodeTooltip()
    if (!hex) return
    const state = this.state
    const hero = state.hero
    const map = state.map
    if (!hero || !map) return
    const k = hexKey(hex)
    const type = map.nodes?.[k]
    if (!type) return
    // 未探索区域的资源点不可见 → 不显示
    if ((state.visibility[hero.faction] ?? {})[k] === 'unexplored') return
    const def = RESOURCE_NODE_DEFS[type]
    const node = state.nodeStates[k]
    const isMineType = Boolean(def.dailyBonus)
    // 已拾取的宝箱已从地图移除 → 悬停不再显示
    if (!isMineType && node?.visited) return
    const desc = isMineType
      ? `每日产出 +${this.formatBonus(def.dailyBonus)}`
      : `一次性 ${this.formatBonus(def.oneTime)}`
    const status = isMineType ? (node?.owner !== null ? '已占领' : '无主，走近占领') : '走近拾取'
    this.nodeDetailText.setText(`${def.name}  ${desc}（${status}）`)
    this.nodeDetailText.setPosition(pointer.x + 12, pointer.y - 8)
    this.nodeDetailText.setVisible(true)
  }

  private hideNodeTooltip(): void {
    this.nodeDetailText.setVisible(false)
  }

  /** `Partial<Resources>` → `金+30 木+5`（正数全列，省略零） */
  private formatBonus(b: Partial<import('../core/state/GameState').Resources> | undefined): string {
    if (!b) return ''
    return (Object.entries(b) as [keyof import('../core/state/GameState').Resources, number][])
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => `${RESOURCE_NAMES[k]}+${v}`)
      .join(' ')
  }

  private handleClick(p: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(p.x, p.y)
    const hex = this.layout.pixelToHex(world.x, world.y)
    const hero = this.state.hero
    // 点击城池格：显示城池详情（不触发移动）
    const town = this.state.towns.find((t) => hexKey(t.position) === hexKey(hex))
    if (town) {
      this.showTownDetail(town, p)
      this.hideNodeTooltip()
      return
    }
    this.hideTownDetail()
    this.hideNodeTooltip()
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
    // preload 加载图标期间 create() 尚未运行，store 未建：返回未就绪，让 e2e waitReady 轮询等待
    if (!this.store) return { ready: false }
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
      // HUD 显示的每日产出汇总（当前势力；城池+已占矿）
      dailyIncome: state.hero ? computeDailyIncome(state, state.hero.faction) : null,
      // HUD 流式布局：每个资源列的图标中心 x / 文本左沿 x（e2e 断言图标与文本不重叠）
      hudLayout: this.hudResourceCols.map((col) => ({
        resource: col.resource,
        iconX: col.icon.x,
        textX: col.text.x
      })),
      towns: state.towns.map((t) => ({ id: t.id, name: t.name, owner: t.owner, level: t.level, position: t.position })),
      nodeStates: {
        picked: Object.values(state.nodeStates).filter((n) => n.visited).length,
        claimedMines: Object.values(state.nodeStates).filter((n) => n.owner !== null).length
      },
      // 当前渲染的资源点 hexKey（仅已探索区域且未拾取宝箱；迷雾/已拾不可见）
      visibleNodes: Object.entries(state.map?.nodes ?? {})
        .filter(([k]) => fog[k] !== 'unexplored')
        .filter(([k]) => {
          const type = state.map?.nodes?.[k]
          if (!type) return false
          const node = state.nodeStates[k]
          // 一次性资源（宝箱）拾取后从地图移除 → 不再视为可见渲染点
          return !RESOURCE_NODE_DEFS[type].oneTime || !node?.visited
        })
        .map(([k]) => k)
        .sort(),
      visibility: counts,
      busy: this.busy,
      bgm: this.bgm ? this.bgm.getState() : null,
      sfx: this.sfx ? this.sfx.getState() : null
    }
  }
}
