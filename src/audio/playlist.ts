/**
 * BGM 播放列表纯逻辑（渲染层、可脱离 Phaser 单测）。
 * 职责：把曲目随机排序成 playlist、顺序推进、到头循环播放整个 playlist。
 * rng 由调用方注入（正式运行传 Math.random；单测传确定性函数）。
 */

/** Fisher–Yates 随机洗牌：返回 tracks 的一个随机重排（不改入参） */
export function shuffleTracks<T>(tracks: readonly T[], rng: () => number): T[] {
  const a = [...tracks]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

/** 播放完当前曲目后的下一首下标；到末尾回到开头（循环 playlist） */
export function nextTrackIndex(current: number, length: number): number {
  if (length === 0) return 0
  return (current + 1) % length
}

/** 上一首下标；到开头回到末尾（循环 playlist） */
export function prevTrackIndex(current: number, length: number): number {
  if (length === 0) return 0
  return (current - 1 + length) % length
}

/**
 * 构建播放列表：主题曲（若有且存在于 tracks）固定第一首，其余随机排序；
 * 主题曲为空串或不在 tracks 中（未找到）则无主题曲、全部随机。
 */
export function buildPlaylist(tracks: readonly string[], theme: string, rng: () => number): string[] {
  const rest = tracks.filter((t) => t !== theme)
  // 主题曲未配置（空串）或未找到：rest 等于全集，全部随机
  if (!theme || rest.length === tracks.length) return shuffleTracks(tracks, rng)
  return [theme, ...shuffleTracks(rest, rng)]
}

/**
 * 构建打乱的播放列表：全部曲目随机排序。
 * 等价于 buildPlaylist(tracks, '', rng)，语义更清晰——用于按分类 shuffle 的场景。
 */
export function buildShuffledPlaylist(tracks: readonly string[], rng: () => number): string[] {
  return shuffleTracks(tracks, rng)
}
