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
    // 遮罩「外点取消」防抖（Leak B）：降/逃/和 在 pointerdown 打开弹窗，同一次点击的收尾
    // pointerup 会落在刚创建的遮罩上——只有 pointerdown 也落在遮罩上才算真正的「外点」，
    // 否则（打开弹窗的那次点击）不关闭。
    let overlayDown = false
    overlay.on('pointerdown', () => { overlayDown = true })
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
      overlay.on('pointerup', () => { if (overlayDown) { overlayDown = false; close(false) } })
    } else {
      const btn = makeButton(scene, cx, cy + 80, opts.closeLabel ?? '关闭', () => close(), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      created.push(btn)
      overlay.on('pointerup', () => { if (overlayDown) { overlayDown = false; close() } })
    }
  })
}

export const openConfirm = (scene: Phaser.Scene, o: { title: string; message: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> =>
  openModal(scene, o) as Promise<boolean>
export const openInfo = (scene: Phaser.Scene, o: { title: string; message: string; closeLabel?: string }): Promise<void> =>
  openModal(scene, o) as Promise<void>
