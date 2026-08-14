/**
 * UI 调色板 token（frontend-design 提议的三国视觉身份；渲染层专用）。
 * core 不感知颜色/分辨率；Text 用 css() 转字符串，Graphics 直接用数值。
 */
export const COLORS = {
  /** 墨底（底色） */
  nightInk: 0x0e1420,
  /** 朱砂红（主强调 / 魏势力 / 印章色） */
  cinnabar: 0xc2392b,
  /** 蜀绿（呼应势力色） */
  jade: 0x2f8f5b,
  /** 鎏金（高亮 / 宝箱 / 英雄） */
  gilt: 0xd4a24c,
  /** 宣纸白（正文文字，替换纯白冷感） */
  parchment: 0xefe6d3,
  /** 青灰（辅助 / 静默信息，如 log） */
  slateAzure: 0x6b7f9b
} as const

/** 数字色值 → CSS 字符串（Phaser Text 的 color/backgroundColor 用） */
export function css(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}

/** 颜色变亮：按比例向白色混合（0=不变，1=全白）；hover 高亮用 */
export function lighten(n: number, amount: number): number {
  const mix = (v: number): number => Math.round(v + (255 - v) * amount)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return (mix(r) << 16) | (mix(g) << 8) | mix(b)
}

/** display 字体 key（= assets/fonts/MaShanZheng-display.woff2 去扩展名；LoadingScene 预载，Text fontFamily 引用） */
export const FONT_DISPLAY = 'MaShanZheng-display'

/** 印章字体 key（= assets/fonts/LXGW-WenKai-seal.woff2；霞鹜文楷含繁体「戰」，马善政 GB2312 无繁体） */
export const FONT_SEAL = 'LXGW-WenKai-seal'

/** 战斗双方势力色（单位六边形格与行动顺序条方块共用；保证两处底色一致） */
export const BATTLE_SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const
