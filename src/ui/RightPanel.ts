import Phaser from 'phaser'
import { currentPlayer, type GameState } from '../core/state/GameState'
import { makeButton } from './button'
import { COLORS, css, lighten } from './theme'

/** 右侧武将/城池列表面板的动作回调（由 AdventureScene 接线到 core 命令 + 刷新） */
export interface RightPanelActions {
  /** 点击武将行 → 切换选中英雄（hero/select） */
  onSelectHero(heroId: string): void
  /** 点击城池行 → 打开城池面板 */
  onOpenTown(townId: string): void
  /** 点击「下一个(h)」/ 按 h 键 → 循环切换选中英雄 */
  onNextHero(): void
  /** 点击「结束回合」→ 结束当前回合（game/advanceTurn；与 E 键等效） */
  onEndTurn(): void
}

/** 武将行调试信息（e2e 读坐标点击 / 断言高亮 / 断言 label 不含误导数字） */
export interface RightPanelHeroRowDebug {
  generalId: string
  name: string
  level: number
  /** 行显示文本（`關羽 Lv5`；已去掉 armyCount 兵力总数——误导数字） */
  label: string
  /** 兵力总数（e2e 兼容保留；不在行 label 中显示） */
  armyCount: number
  selected: boolean
  x: number
  y: number
}

/** 城池行调试信息（e2e 读坐标点击 / 断言） */
export interface RightPanelTownRowDebug {
  id: string
  name: string
  level: number
  x: number
  y: number
}

/**
 * 右侧武将/城池列表面板（渲染层组件，简单列表，不做美化——美化后置）。
 *
 * 内容（按当前玩家 players[currentPlayerId]）：
 * - 武将行：名字 / 等级（去掉了兵力总数——误导），点击 → hero/select 切换选中英雄，当前选中行高亮（绿底，呼应英雄金点高亮）；
 * - 城池行：名字 / 等级，点击 → 打开城池面板（openTownPanel）；
 * - 「下一个(h)」按钮：在当前玩家英雄列表中循环切换（与 H 键等效）；
 * - 「结束回合」按钮：结束当前回合（game/advanceTurn，与 E 键等效；从右下角移入面板）。
 *
 * 固定屏幕右侧（UI 相机渲染，setScrollFactor(0) 不随地图缩放/滚动）。
 * refresh(state) 每次读 core 最新状态整体重绘；destroy() 清理全部对象。
 */
export class RightPanel {
  /** 面板宽（px） */
  private static readonly PANEL_W = 160
  /** 右缘留白（px）：左缘 = 宽 - 160 - 10 = 宽 - 170 */
  private static readonly RIGHT_MARGIN = 10
  /** 面板起始 y（px，HUD 之下） */
  private static readonly TOP_Y = 120
  /** 行距（px） */
  private static readonly ROW_H = 34
  /** 分组标题高度（px） */
  private static readonly HEADER_H = 28

  private readonly scene: Phaser.Scene
  private readonly actions: RightPanelActions
  private objects: Phaser.GameObjects.GameObject[] = []
  private heroRows: RightPanelHeroRowDebug[] = []
  private townRows: RightPanelTownRowDebug[] = []
  private nextBtn: { x: number; y: number; label: string } | null = null
  private endTurnBtn: { x: number; y: number; label: string } | null = null
  private destroyed = false

  constructor(scene: Phaser.Scene, actions: RightPanelActions) {
    this.scene = scene
    this.actions = actions
  }

  /** 读 core 状态整体重绘（destroy 后 no-op） */
  refresh(state: GameState): void {
    if (this.destroyed) return
    this.clear()
    const cam = this.scene.cameras.main
    const left = cam.width - RightPanel.PANEL_W - RightPanel.RIGHT_MARGIN
    const centerX = left + RightPanel.PANEL_W / 2
    const player = currentPlayer(state)
    const mine = state.heroes.filter((h) => h.playerId === player?.id)

    let y = RightPanel.TOP_Y

    // 武将分组
    this.addHeader(centerX, y, '武将')
    y += RightPanel.HEADER_H
    if (mine.length === 0) {
      this.addText(centerX, y, '（无）', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: css(COLORS.slateAzure)
      })
      y += RightPanel.ROW_H
    } else {
      for (const hero of mine) {
        const general = state.generals.find((g) => g.id === hero.generalId)
        const armyCount = (general?.army ?? []).reduce((sum, u) => sum + u.count, 0)
        const selected = hero.generalId === state.selectedHeroId
        // 行 label 去掉兵力总数（那个数字是兵力总数，误导）；armyCount 保留在 debug 供 e2e 断言
        const label = `${general?.name ?? hero.generalId} Lv${general?.level ?? '?'}`
        const btn = this.addRow(centerX, y, label, () => this.actions.onSelectHero(hero.generalId), selected)
        this.heroRows.push({
          generalId: hero.generalId,
          name: general?.name ?? hero.generalId,
          level: general?.level ?? 0,
          label,
          armyCount,
          selected,
          x: btn.x,
          y: btn.y
        })
        y += RightPanel.ROW_H
      }
    }

    // 城池分组
    y += 6
    this.addHeader(centerX, y, '城池')
    y += RightPanel.HEADER_H
    const myTowns = state.towns.filter((t) => t.owner === player?.id)
    if (myTowns.length === 0) {
      this.addText(centerX, y, '（无）', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: css(COLORS.slateAzure)
      })
      y += RightPanel.ROW_H
    } else {
      for (const town of myTowns) {
        const label = `${town.name} Lv${town.level}`
        const btn = this.addRow(centerX, y, label, () => this.actions.onOpenTown(town.id), false)
        this.townRows.push({ id: town.id, name: town.name, level: town.level, x: btn.x, y: btn.y })
        y += RightPanel.ROW_H
      }
    }

    // 「下一个(h)」按钮
    y += 10
    const next = this.addButton(centerX, y, '下一个(h)', () => this.actions.onNextHero())
    this.nextBtn = { x: next.x, y: next.y, label: '下一个(h)' }
    y += RightPanel.ROW_H

    // 「结束回合」按钮（Task 3：从右下角移入面板，同回调 endTurn()）
    const endTurn = this.addButton(centerX, y, '结束回合 [E]', () => this.actions.onEndTurn())
    this.endTurnBtn = { x: endTurn.x, y: endTurn.y, label: '结束回合 [E]' }
    y += RightPanel.ROW_H

    // 面板底（简单半透明 + 鎏金描边；创建在最后但 depth 更低 → 垫在行之下）
    const bg = this.uiOnly(this.scene.add.graphics().setDepth(13).setScrollFactor(0))
    const top = RightPanel.TOP_Y - 10
    const bottom = y + 6
    bg.fillStyle(0x0e1420, 0.55)
    bg.fillRoundedRect(left - 8, top, RightPanel.PANEL_W + 16, bottom - top, 8)
    bg.lineStyle(1, COLORS.gilt, 0.6)
    bg.strokeRoundedRect(left - 8, top, RightPanel.PANEL_W + 16, bottom - top, 8)
    this.objects.push(bg)
  }

  /** 清理全部对象（场景 shutdown 时 Phaser 已自动销毁 → destroy 容错） */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.clear()
  }

  /** 供 dev bridge / e2e：当前面板内容 + 按钮坐标 */
  getDebugState(): Record<string, unknown> {
    return {
      heroes: this.heroRows,
      towns: this.townRows,
      next: this.nextBtn,
      endTurn: this.endTurnBtn
    }
  }

  // ---------- 渲染辅助 ----------

  private clear(): void {
    for (const o of this.objects) {
      // 场景 shutdown 已销毁的对象再 destroy 可能抛错 → 容错 no-op
      try {
        o.destroy()
      } catch {
        /* 已随场景销毁 */
      }
    }
    this.objects = []
    this.heroRows = []
    this.townRows = []
    this.nextBtn = null
    this.endTurnBtn = null
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
    style: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    const t = this.uiOnly(
      this.scene.add.text(x, y, text, style).setOrigin(0.5, 0.5).setDepth(14).setScrollFactor(0)
    )
    this.objects.push(t)
    return t
  }

  private addHeader(x: number, y: number, text: string): void {
    this.addText(x, y, text, {
      fontFamily: 'sans-serif',
      fontSize: '17px',
      color: css(COLORS.gilt),
      fontStyle: 'bold'
    })
  }

  /** 列表行按钮：点击触发 onClick；selected 用蜀绿底高亮（与当前英雄高亮呼应） */
  private addRow(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    selected: boolean
  ): Phaser.GameObjects.Text {
    const background = selected ? COLORS.jade : 0x33415c
    const btn = this.uiOnly(
      makeButton(this.scene, x, y, label, onClick, {
        fontSize: 15,
        minWidth: RightPanel.PANEL_W - 14,
        background,
        hoverBackground: lighten(background, 0.18),
        padding: { x: 4, y: 3 }
      })
        .setDepth(14)
        .setScrollFactor(0)
    )
    this.objects.push(btn)
    return btn
  }

  private addButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const btn = this.uiOnly(
      makeButton(this.scene, x, y, label, onClick, {
        fontSize: 16,
        minWidth: RightPanel.PANEL_W - 14,
        padding: { x: 4, y: 4 }
      })
        .setDepth(14)
        .setScrollFactor(0)
    )
    this.objects.push(btn)
    return btn
  }
}
