import Phaser from 'phaser'
import { makeButton } from './button'

/** 战斗操作按钮定义（当前：跳过行动 / 撤退；后续加 待命 / 防御 等） */
export interface OperationButtonSpec {
  label: string
  onClick: () => void
}

export interface OperationButtonsOptions {
  /** 距视口右缘（px） */
  cornerX?: number
  /** 距视口底缘（px） */
  cornerY?: number
  /** 按钮纵向间距（px） */
  gapY?: number
  /** 统一宽度（px）；>0 时各按钮等宽 */
  minWidth?: number
}

/**
 * 战斗操作按钮组（渲染层）：右下角一列操作按钮（跳过行动 / 撤退，后续加待命/防御）。
 * 统一管理：贴右下角定位、resize 自重排、**整体显隐**（结算时 `setVisible(false)`）。
 * 生命周期：场景 shutdown 时调用 `destroy()`（注销 resize 监听 + 销毁按钮）。
 */
export class OperationButtons {
  private readonly buttons: Phaser.GameObjects.Text[] = []
  private visible = true

  constructor(
    private readonly scene: Phaser.Scene,
    specs: OperationButtonSpec[],
    private readonly opts: OperationButtonsOptions = {}
  ) {
    const { cornerX = 40, cornerY = 40, minWidth = 110 } = opts
    this.buttons = specs.map((spec) =>
      makeButton(scene, cornerX, cornerY, spec.label, spec.onClick, {
        fontSize: 20,
        origin: { x: 1, y: 0.5 },
        minWidth
      })
        .setDepth(12)
        .setScrollFactor(0)
    )
    this.reposition()
    scene.scale.on('resize', this.reposition)
  }

  /** 贴右下角竖直排列（最后一个 spec = 最靠近角落） */
  private readonly reposition = (): void => {
    const cam = this.scene.cameras.main
    const { cornerX = 40, cornerY = 40, gapY = 60 } = this.opts
    let y = cam.height - cornerY
    for (const btn of this.buttons) {
      btn.setPosition(cam.width - cornerX, y)
      y -= gapY
    }
  }

  /** 整体显隐（结算时隐藏全部操作按钮） */
  setVisible(visible: boolean): void {
    this.visible = visible
    for (const btn of this.buttons) btn.setVisible(visible)
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.scene.scale.off('resize', this.reposition)
    for (const btn of this.buttons) btn.destroy()
    this.buttons.length = 0
  }
}
