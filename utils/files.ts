// 图片识别、自然排序、文件夹扫描逻辑（File System Access API）

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

export interface ImageEntry {
  /** 文件名（不含文件夹名） */
  name: string;
  /** 相对路径（顶层即文件名） */
  relativePath: string;
  /** 文件句柄，用于后续按需读取图片 */
  fileHandle: FileSystemFileHandle;
}

export interface ScanResult {
  images: ImageEntry[];
  /** 是否检测到子文件夹（用于提示“只能导入单一文件夹”） */
  hasSubfolders: boolean;
}

/** 判断文件名是否为支持的图片格式 */
export function isSupportedImage(name: string): boolean {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0) return false;
  const ext = name.slice(dotIndex + 1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/** 自然排序（数字感知，2.png 排在 10.png 之前） */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * 仅扫描所选文件夹顶层，识别支持的图片并自然排序。
 * 子文件夹不进入，但会记录 hasSubfolders 以便提示用户。
 */
export async function scanTopLevelImages(
  dirHandle: FileSystemDirectoryHandle,
): Promise<ScanResult> {
  const images: ImageEntry[] = [];
  let hasSubfolders = false;

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      hasSubfolders = true;
      continue;
    }
    if (isSupportedImage(name)) {
      images.push({
        name,
        relativePath: name,
        fileHandle: handle as FileSystemFileHandle,
      });
    }
  }

  images.sort((a, b) => naturalCompare(a.name, b.name));
  return { images, hasSubfolders };
}