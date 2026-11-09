// 阅读器配置：存取于 chrome.storage.sync；缩放记忆存于 chrome.storage.local（设备本地）
import type { LangSetting } from './i18n';

export type ReaderMode = 'scroll' | 'single' | 'double';
export type Theme = 'light' | 'dark';
export type ZoomDefault = 'fixed' | 'memory';

export interface ReaderConfig {
  lang: LangSetting;
  defaultMode: ReaderMode;
  theme: Theme;
  zoomDefault: ZoomDefault;
  /** 隐藏/唤回状态栏的快捷键（默认 F） */
  hideKey: string;
}

export const DEFAULT_CONFIG: ReaderConfig = {
  lang: 'system',
  defaultMode: 'scroll',
  theme: 'light',
  zoomDefault: 'fixed',
  hideKey: 'f',
};

const CONFIG_KEY = 'config';
const LAST_ZOOM_KEY = 'lastZoom';
const LAST_POS_KEY = 'lastPosition';

/** 各文件夹的阅读位置（文件夹名 → 图片索引） */
export type ReadingPositions = Record<string, number>;

/**
 * 安全获取 storage 区域。
 * 说明：WebExtension 的 storage 在极少数上下文（如非扩展页面、受限环境）可能不可用，
 * 直接访问 `chrome.storage.xxx` 会抛错并导致阅读器整页白屏，故此处做边界防御，
 * 不可用时返回 null，由调用方降级为默认值。
 */
function getStorageArea(kind: 'sync' | 'local') {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.[kind]) {
      return chrome.storage[kind];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadConfig(): Promise<ReaderConfig> {
  const area = getStorageArea('sync');
  if (!area) return { ...DEFAULT_CONFIG };
  try {
    const stored = await area.get(CONFIG_KEY);
    const raw = (stored?.[CONFIG_KEY] ?? {}) as Partial<ReaderConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: ReaderConfig): Promise<void> {
  const area = getStorageArea('sync');
  if (!area) return;
  try {
    await area.set({ [CONFIG_KEY]: config });
  } catch {
    /* ignore */
  }
}

export async function loadLastZoom(): Promise<number | undefined> {
  const area = getStorageArea('local');
  if (!area) return undefined;
  try {
    const stored = await area.get(LAST_ZOOM_KEY);
    const v = stored?.[LAST_ZOOM_KEY];
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function saveLastZoom(zoom: number): Promise<void> {
  const area = getStorageArea('local');
  if (!area) return;
  try {
    await area.set({ [LAST_ZOOM_KEY]: zoom });
  } catch {
    /* ignore */
  }
}

// 阅读位置按文件夹名分别存储，避免切换文件夹时互相覆盖（内存缓存避免读改写竞态）
let posCache: ReadingPositions | undefined;

async function getPositions(): Promise<ReadingPositions> {
  if (posCache) return posCache;
  const area = getStorageArea('local');
  if (!area) return (posCache = {});
  try {
    const stored = await area.get(LAST_POS_KEY);
    const v = stored?.[LAST_POS_KEY];
    posCache = v && typeof v === 'object' ? { ...(v as ReadingPositions) } : {};
  } catch {
    posCache = {};
  }
  return posCache;
}

/** 读取指定文件夹上次阅读到的图片索引 */
export async function loadPosition(dir: string): Promise<number | undefined> {
  const map = await getPositions();
  return typeof map[dir] === 'number' ? map[dir] : undefined;
}

/** 保存指定文件夹的阅读位置（图片索引） */
export async function savePosition(dir: string, index: number): Promise<void> {
  const map = await getPositions();
  if (map[dir] === index) return;
  map[dir] = index;
  const area = getStorageArea('local');
  if (!area) return;
  try {
    await area.set({ [LAST_POS_KEY]: { ...map } });
  } catch {
    /* ignore */
  }
}
