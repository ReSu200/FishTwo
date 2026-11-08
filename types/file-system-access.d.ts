// 补充 TypeScript 7 lib 中缺失的 File System Access API 类型声明

interface FileSystemDirectoryHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?:
      | 'desktop'
      | 'documents'
      | 'downloads'
      | 'music'
      | 'pictures'
      | 'videos'
      | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;
}

// Chromium 扩展页面使用完整的 chrome 命名空间（Edge 的 browser 别名可能不完整，缺 storage）
declare const chrome: typeof browser;