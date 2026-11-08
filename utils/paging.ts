// 双页翻页（漫画式：第一页为单页封面，之后两页一组）的分页计算

/** 双页模式下总的“翻页屏数”：封面 1 屏 + 其余图片两两一组 */
export function doubleSpreadCount(total: number): number {
  if (total <= 0) return 0;
  return 1 + Math.ceil((total - 1) / 2);
}

/** 某个图片索引落在哪一屏（封面为 0，其后两页一组） */
export function spreadOfIndex(index: number): number {
  if (index <= 0) return 0;
  return Math.floor((index + 1) / 2);
}

/** 某一屏应展示的图片索引列表（封面屏仅 [0]） */
export function doubleIndices(spread: number, total: number): number[] {
  if (spread <= 0) return total > 0 ? [0] : [];
  const left = 2 * spread - 1;
  const right = 2 * spread;
  const indices = [left];
  if (right < total) indices.push(right);
  return indices;
}