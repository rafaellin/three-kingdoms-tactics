import Phaser from 'phaser'
import { currentHero, type GameState } from '../core/state/GameState'
import { UNIT_DEFS } from '../data/units'
import { COLORS, css } from './theme'

/**
 * 底部当前武将信息条（渲染层组件，纯显示，不做美化——美化后置）。
 *
 * 屏幕最底部一行，显示当前选中武将（currentHero = selectedHeroId，回退 heroes[0]）：
 * - `名字 Lv等级 移动力 X/Y`（如 `關羽 Lv5 移动力 6/6`）；
 * - 带部队逐格列出 `兵种名 ×数量`（如 `刀兵 ×20  弓兵 ×12`），像战斗行动顺序条那样每个兵种一个条目。
 *
 * 固定屏幕底部（UI 相机渲染：`cameras.main.ignore` + `setScrollFactor(0)`，不随地图缩放/滚动；
 * 不设 setInteractive → 不拦截地图拖拽/滚轮/点击）。
 * refresh(state) 每次读 core 最新状态整体重绘（重读 cam → 天然跟随 resize）；
 * getDebugState() 暴露文本供 e2e 断言；destroy() 清理对象并注销 resize 监听。
 */
export class StatusBar {
  /** 条高（px） */
  private static readonly BAR_H = 46
  /** 左缘留白（px） */
  private static readonly LEFT_MARGIN = 16
  /** hero 文本与部队条目间距（px） */
  private static readonly HERO_GAP = 18
  /** 部队条目间距（px） */
  private static readonly UNIT_GAP = 10

  private readonly scene: Phaser.Scene
  private readonly objects: Phaser.GameObjects.GameObject[] = []
  private lastState: GameState | null = null
  private destroyed = false
  private lastHero = ''
  private lastUnits: string[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.scene.scale.on('resize', this.onResize)
  }

  /** 读 core 状态整体重绘（destroy 后 no-op） */
  refresh(state: GameState): void {
    if (this.destroyed) return
    this.lastState = state
    this.clear()
    const cam = this.scene.cameras.main
    this.drawBar(cam.width, cam.height)

    const hero = currentHero(state)
    if (!hero) {
      this.lastHero = ''
      this.lastUnits = []
      return
    }
    const general = state.generals.find((g) => g.id === hero.generalId)
    const name = general?.name ?? hero.generalId
    const level = general?.level ?? '?'
    this.lastHero = `${name} Lv${level} 移动力 ${formatMovement(hero.movementLeft)}/${hero.maxMovement}`
    this.lastUnits = (general?.army ?? []).map((u) => `${UNIT_DEFS[u.defId].name} ×${u.count}`)

    // 流式排布：hero 文本左对齐，部队条目逐个向右排（取文本实际宽度推进游标）
    const y = cam.height - StatusBar.BAR_H / 2
    let x = StatusBar.LEFT_MARGIN
    const heroText = this.addText(x, y, this.lastHero, {
      fontFamily: 'sans-serif',
      fontSize: '19px',
      fontStyle: 'bold',
      color: css(COLORS.gilt)
    })
    x = heroText.x + heroText.width + StatusBar.HERO_GAP
    for (const unitText of this.lastUnits) {
      const t = this.addText(
        x,
        y,
        unitText,
        {
          fontFamily: 'sans-serif',
          fontSize: '17px',
          color: '#ffffff',
          backgroundColor: css(0x33415c)
        },
        { x: 8, y: 3 }
      )
      x = t.x + t.width + StatusBar.UNIT_GAP
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.scale.off('resize', this.onResize)
    this.clear()
  }

  /** 供 dev bridge / e2e：信息条当前文本（hero = 单行武将信息；units = 部队条目列表） */
  getDebugState(): Record<string, unknown> {
    return {
      hero: this.lastHero,
      units: this.lastUnits,
      text: [this.lastHero, ...this.lastUnits].filter(Boolean).join('  ')
    }
  }

  // ---------- 渲染辅助 ----------

  private readonly onResize = (): void => {
    if (this.lastState) this.refresh(this.lastState)
  }

  private clear(): void {
    for (const o of this.objects) {
      // 场景 shutdown 已销毁的对象再 destroy 可能抛错 → 容错 no-op
      try {
        o.destroy()
      } catch {
        /* 已随场景销毁 */
      }
    }
    this.objects.length = 0
  }

  /** 只由 UI 相机渲染（忽略主相机 → 不随地图缩放/滚动） */
  private uiOnly<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.scene.cameras.main.ignore(obj)
    return obj
  }

  private addText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    padding?: { x: number; y: number }
  ): Phaser.GameObjects.Text {
    const t = this.uiOnly(
      this.scene.add.text(x, y, text, style).setOrigin(0, 0.5).setDepth(14).setScrollFactor(0)
    )
    if (padding) t.setPadding(padding.x, padding.y)
    this.objects.push(t)
    return t
  }

  /** 底部通栏条：半透明墨色底 + 鎏金顶线（与战斗行动顺序条同系） */
  private drawBar(w: number, h: number): void {
    const g = this.uiOnly(this.scene.add.graphics().setDepth(13).setScrollFactor(0))
    g.fillStyle(COLORS.nightInk, 0.62)
    g.fillRect(0, h - StatusBar.BAR_H, w, StatusBar.BAR_H)
    g.lineStyle(1, COLORS.gilt, 0.5)
    g.lineBetween(0, h - StatusBar.BAR_H, w, h - StatusBar.BAR_H)
    this.objects.push(g)
  }
}

/** 移动力显示：整数原样输出，小数保留 1 位（地形代价如森林 1.5） */
function formatMovement(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
