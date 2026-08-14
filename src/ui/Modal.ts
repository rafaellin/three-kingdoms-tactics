import Phaser from 'phaser'
import { makeButton } from './button'
import { css, COLORS } from './theme'

export interface ModalOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  closeLabel?: string
  /** 任意关闭路径（确认/取消/遮罩外/关闭）同步回调：供场景重置输入状态（dragging/swallowUp），杜绝尾随 pointerup 泄漏 */
  onClose?: () => void
}

/** 确认/取消 按钮中心间距（px）—— 分开排布，避免并排按钮重叠 */
const BTN_GAP = 130

/**
 * 统一弹窗组件（渲染层）：半透明全屏遮罩（interactive，挡住下方地图输入）+ 居中面板 + 标题/正文 + 按钮。
 *
 * 输入隔离铁律（防止事件泄漏到场景/地图）：
 *  - 只响应左键（p.button === 0），右键/中键不触发任何弹窗逻辑；
 *  - 遮罩「外点取消」要求 pointerdown 与 pointerup 都落在遮罩上（Leak B）——
 *    降/逃/和 在 pointerdown 打开弹窗，同一次点击的收尾 pointerup 落在刚创建的遮罩上不算「外点」；
 *  - 任何关闭路径都在 close() 里**同步**调用 opts.onClose（场景借此在尾随 pointerup 之前
 *    重置 dragging / swallowUp——异步微任务太晚，会把关闭后的 pointerup 泄漏成地图操作）。
 *
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
    // 外点判定：pointerdown 落在遮罩上才记录；pointerup 仅当 down 也在遮罩上才取消
    let overlayDown = false
    overlay.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 0) overlayDown = true
    })
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
      opts.onClose?.() // 同步回调：赶在尾随 pointerup 之前重置场景输入状态
      resolve(result)
    }
    const outsideUp = (): void => {
      if (overlayDown) {
        overlayDown = false
        close(false)
      }
    }
    if (opts.confirmLabel !== undefined) {
      const confirm = makeButton(scene, cx + BTN_GAP, cy + 80, opts.confirmLabel ?? '确定', () => close(true), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      const cancel = makeButton(scene, cx - BTN_GAP, cy + 80, opts.cancelLabel ?? '取消', () => close(false), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      created.push(confirm, cancel)
      overlay.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.button === 0) outsideUp()
      })
    } else {
      const btn = makeButton(scene, cx, cy + 80, opts.closeLabel ?? '关闭', () => close(), { minWidth: 120, fontSize: 18 }).setDepth(32).setScrollFactor(0)
      created.push(btn)
      overlay.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.button === 0) outsideUp()
      })
    }
  })
}

export const openConfirm = (scene: Phaser.Scene, o: { title: string; message: string; confirmLabel?: string; cancelLabel?: string; onClose?: () => void }): Promise<boolean> =>
  openModal(scene, o) as Promise<boolean>
export const openInfo = (scene: Phaser.Scene, o: { title: string; message: string; closeLabel?: string; onClose?: () => void }): Promise<void> =>
  openModal(scene, o) as Promise<void>
