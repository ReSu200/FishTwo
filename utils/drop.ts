// 拖入文件夹：从 DataTransferItem 解析目录句柄（Chromium / Edge）

/** 当前环境是否支持从拖入项获取 FileSystemHandle */
export function supportsDirectoryDrop(): boolean {
  return (
    typeof DataTransferItem !== 'undefined' &&
    typeof DataTransferItem.prototype.getAsFileSystemHandle === 'function'
  );
}

/** 取拖入项中的第一个目录句柄；没有目录时返回 null */
export async function extractDirectoryHandle(
  items: DataTransferItemList,
): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryDrop()) return null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || item.kind !== 'file') continue;
    try {
      const handle = await item.getAsFileSystemHandle?.();
      if (handle && handle.kind === 'directory') {
        return handle as FileSystemDirectoryHandle;
      }
    } catch {
      /* 单个条目解析失败时继续尝试下一个 */
    }
  }
  return null;
}
