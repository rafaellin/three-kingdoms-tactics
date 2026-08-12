/**
 * 资源 key 共享模块（渲染层）。
 *
 * 集中管理 BGM / SFX / icon 的 Vite glob 与缓存 key 派生，
 * 供 BgmManager / SfxManager / LoadingScene 共用，
 * 避免不同模块各自维护相同 glob 导致 key 不一致 → 静默 BGM 失败。
 */

/** BGM（只扫 assets/bgm/mp3/；wav/ 原声碟不加载）；.pkf 等伴生文件自动忽略 */
export const BGM_URLS = import.meta.glob('/assets/bgm/mp3/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 音效 */
export const SFX_URLS = import.meta.glob('/assets/sound/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 图标资源 */
export const ICON_URLS = import.meta.glob('/assets/icons/*.png', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 路径 → 缓存 key：取文件名（去扩展名），如 '/assets/bgm/mp3/Neon Jade.mp3' → 'Neon Jade' */
export function baseKey(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.[^.]+$/, '')
}
