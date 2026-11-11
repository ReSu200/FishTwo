// 文件夹级错误分类与目录探测：避免把原始 DOMException 直接展示给用户

export type FolderErrorKind = 'not-found' | 'permission' | 'unknown';

/** 根据异常对象判断文件夹错误类型 */
export function classifyFolderError(error: unknown): FolderErrorKind {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';
  if (name === 'NotFoundError') return 'not-found';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  return 'unknown';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(new DOMException('Directory probe timed out', 'TimeoutError'));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(id);
        reject(error);
      },
    );
  });
}

/**
 * 探测目录是否仍可读。
 * 只读取第一项，不遍历整个目录；超时按 unknown 处理。
 */
export async function probeDirectory(
  handle: FileSystemDirectoryHandle,
  timeoutMs = 1500,
): Promise<FolderErrorKind | 'ok'> {
  try {
    const permission = await withTimeout(handle.queryPermission({ mode: 'read' }), timeoutMs);
    if (permission !== 'granted') return 'permission';
    // 空目录 next() 会成功返回 done: true，同样视为可读
    await withTimeout(handle.entries().next(), timeoutMs);
    return 'ok';
  } catch (error) {
    return classifyFolderError(error);
  }
}
