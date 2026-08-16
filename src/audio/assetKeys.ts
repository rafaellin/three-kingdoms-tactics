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

/** 音效（递归：assets/sound/ 及子目录 campaign/ 下的旁白等；新增文件无需改代码） */
export const SFX_URLS = import.meta.glob('/assets/sound/**/*.{wav,mp3,ogg,m4a}', {
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

/** 字体资源（display 角色；LoadingScene 一次性预载，key = 文件名去扩展名） */
export const FONT_URLS = import.meta.glob('/assets/fonts/*.woff2', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 路径 → 缓存 key：取文件名（去扩展名），如 '/assets/bgm/mp3/Neon Jade.mp3' → 'Neon Jade' */
export function baseKey(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.[^.]+$/, '')
}

/** 同文件多格式时的加载优先级（体积小/兼容性好优先）：mp3 > m4a > ogg > wav */
const AUDIO_PRIORITY: Record<string, number> = { mp3: 0, m4a: 1, ogg: 2, wav: 3 }

function audioPriority(path: string): number {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return AUDIO_PRIORITY[ext] ?? 99
}

/**
 * 按「文件名去扩展名」去重：同一 base name 存在多格式（如 campaign 1.mp3 + campaign 1.wav）
 * 时只保留优先级最高的一个（mp3），避免重复加载大文件、缓存 key 冲突。
 * 返回 key（= baseKey）→ url。
 */
export function dedupeAudio(urls: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, url] of Object.entries(urls)) {
    const key = baseKey(path)
    const prio = audioPriority(path)
    const prev = out[key]
    if (prev === undefined || prio < audioPriority(prev)) out[key] = url
  }
  return out
}

/** SFX 去重后（key=文件名去扩展名 → url）：LoadingScene 用它预载、SfxManager 用它建 key 集 */
export const SFX_AUDIO = dedupeAudio(SFX_URLS)
