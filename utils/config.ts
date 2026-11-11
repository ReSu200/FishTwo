// 阅读器配置：存取于 chrome.storage.sync；文件夹阅读状态存于 chrome.storage.local
import type { LangSetting } from './i18n';
import type { FolderErrorKind } from './folder-error';

export type ReaderMode = 'scroll' | 'single' | 'double';
export type Theme = 'light' | 'dark';
export type ZoomDefault = 'fixed' | 'memory';

/** 可自定义的快捷键动作（翻页与缩放保持固定键位） */
export type ShortcutAction = 'dir' | 'immersive' | 'fullscreen';

export interface Shortcuts {
  dir: string;
  immersive: string;
  fullscreen: string;
}

export interface ReaderConfig {
  lang: LangSetting;
  defaultMode: ReaderMode;
  theme: Theme;
  zoomDefault: ZoomDefault;
  shortcuts: Shortcuts;
  /** @deprecated 旧版本字段，仅用于迁移 */
  hideKey?: string;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

export const DEFAULT_SHORTCUTS: Shortcuts = {
  dir: 'd',
  immersive: 'f',
  fullscreen: 'g',
};

/** 保留键位：Q / E 用于旋转，? 用于帮助，不允许被自定义快捷键占用 */
export const RESERVED_SHORTCUT_KEYS = new Set(['q', 'e', '?']);

export const DEFAULT_CONFIG: ReaderConfig = {
  lang: 'system',
  defaultMode: 'scroll',
  theme: 'light',
  zoomDefault: 'fixed',
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

/** 按文件夹记忆的阅读状态：图片索引 + 阅读模式 + 缩放比例 */
export interface FolderState {
  index?: number;
  mode?: ReaderMode;
  zoom?: number;
}

export type FolderStateMap = Record<string, FolderState>;

export interface InvalidFolderInfo {
  kind: FolderErrorKind;
  at: number;
}

export type InvalidFolderMap = Record<string, InvalidFolderInfo>;

const CONFIG_KEY = 'config';
const LAST_ZOOM_KEY = 'lastZoom';
/** 旧版位置键：仅读取迁移，不再写入 */
const LEGACY_POS_KEY = 'lastPosition';
const FOLDER_STATE_KEY = 'folderState';
const INVALID_FOLDERS_KEY = 'invalidFolders';

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

function isReaderMode(value: unknown): value is ReaderMode {
  return value === 'scroll' || value === 'single' || value === 'double';
}

/** 规范化单个快捷键：仅接受单个字母，保留键回落默认值 */
export function normalizeShortcutKey(raw: unknown, fallback: string): string {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z]$/.test(v) || RESERVED_SHORTCUT_KEYS.has(v)) return fallback;
  return v;
}

export function isReservedShortcutKey(key: string): boolean {
  return RESERVED_SHORTCUT_KEYS.has(key.toLowerCase());
}

function pickUniqueKey(preferred: string, fallback: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  if (!used.has(fallback)) return fallback;
  for (const c of 'dfghijklmnoprstuvwxyz') {
    if (!used.has(c)) return c;
  }
  return fallback;
}

/** 清洗快捷键配置：单字母、去重、保留键回落 */
export function normalizeShortcuts(
  raw: Partial<Shortcuts> | undefined,
  legacyHideKey?: string,
): Shortcuts {
  const used = new Set<string>();
  const result: Shortcuts = { ...DEFAULT_SHORTCUTS };
  const entries: [ShortcutAction, string][] = [
    ['dir', normalizeShortcutKey(raw?.dir, DEFAULT_SHORTCUTS.dir)],
    ['immersive', normalizeShortcutKey(raw?.immersive ?? legacyHideKey, DEFAULT_SHORTCUTS.immersive)],
    ['fullscreen', normalizeShortcutKey(raw?.fullscreen, DEFAULT_SHORTCUTS.fullscreen)],
  ];
  for (const [action, preferred] of entries) {
    const key = pickUniqueKey(preferred, DEFAULT_SHORTCUTS[action], used);
    used.add(key);
    result[action] = key;
  }
  return result;
}

export async function loadConfig(): Promise<ReaderConfig> {
  const area = getStorageArea('sync');
  if (!area) return { ...DEFAULT_CONFIG, shortcuts: { ...DEFAULT_SHORTCUTS } };
  try {
    const stored = await area.get(CONFIG_KEY);
    const raw = (stored?.[CONFIG_KEY] ?? {}) as Partial<ReaderConfig>;
    const defaultMode = isReaderMode(raw.defaultMode) ? raw.defaultMode : DEFAULT_CONFIG.defaultMode;
    const zoomDefault =
      raw.zoomDefault === 'memory' || raw.zoomDefault === 'fixed'
        ? raw.zoomDefault
        : DEFAULT_CONFIG.zoomDefault;
    const shortcuts = normalizeShortcuts(
      raw.shortcuts,
      typeof raw.hideKey === 'string' ? raw.hideKey : undefined,
    );
    return { ...DEFAULT_CONFIG, ...raw, defaultMode, zoomDefault, shortcuts };
  } catch {
    return { ...DEFAULT_CONFIG, shortcuts: { ...DEFAULT_SHORTCUTS } };
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

// 文件夹状态缓存：避免读改写竞态；读取时同时完成旧版 lastPosition 迁移
let folderCache: FolderStateMap | undefined;
// 首次读取时缓存 in-flight Promise，避免并发读取各自生成一份 map 导致写入丢失
let folderPromise: Promise<FolderStateMap> | undefined;
// 串行化写入，避免切换文件夹时两次 area.set 乱序导致旧快照覆盖新快照
let folderWrite: Promise<void> = Promise.resolve();

function sanitizeFolderState(raw: unknown): FolderState {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const state: FolderState = {};
  if (typeof obj['index'] === 'number' && Number.isFinite(obj['index']) && obj['index'] >= 0) {
    state.index = Math.floor(obj['index']);
  }
  if (isReaderMode(obj['mode'])) state.mode = obj['mode'];
  if (typeof obj['zoom'] === 'number' && Number.isFinite(obj['zoom'])) {
    state.zoom = clampZoom(obj['zoom']);
  }
  return state;
}

async function readFolderStates(): Promise<FolderStateMap> {
  const area = getStorageArea('local');
  if (!area) return {};
  try {
    const stored = await area.get([FOLDER_STATE_KEY, LEGACY_POS_KEY]);
    const raw = stored?.[FOLDER_STATE_KEY];
    const map: FolderStateMap = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
        map[dir] = sanitizeFolderState(value);
      }
    } else {
      // 旧版只有图片索引，迁移为 FolderState（模式与缩放留空，按 popup 默认值回落）
      const legacy = stored?.[LEGACY_POS_KEY];
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const [dir, value] of Object.entries(legacy as Record<string, unknown>)) {
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            map[dir] = { index: Math.floor(value) };
          }
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

async function getFolderStates(): Promise<FolderStateMap> {
  if (folderCache) return folderCache;
  if (!folderPromise) folderPromise = readFolderStates();
  const map = await folderPromise;
  folderCache = map;
  folderPromise = undefined;
  return map;
}

/** 读取指定文件夹上次的阅读状态 */
export async function loadFolderState(dir: string): Promise<FolderState | undefined> {
  const map = await getFolderStates();
  return map[dir];
}

/** 保存指定文件夹的阅读状态（合并写；调用方负责防抖） */
export async function saveFolderState(dir: string, patch: FolderState): Promise<void> {
  const map = await getFolderStates();
  map[dir] = { ...map[dir], ...patch };
  const area = getStorageArea('local');
  if (!area) return;
  const snapshot = { ...map };
  folderWrite = folderWrite.then(async () => {
    try {
      await area.set({ [FOLDER_STATE_KEY]: snapshot });
    } catch {
      /* ignore */
    }
  });
  await folderWrite;
}

/** 删除指定文件夹的阅读状态（F9 勾选「同时清除阅读记忆」时使用） */
export async function clearFolderStates(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const map = await getFolderStates();
  let changed = false;
  for (const name of names) {
    if (name in map) {
      delete map[name];
      changed = true;
    }
  }
  if (!changed) return;
  const area = getStorageArea('local');
  if (!area) return;
  const snapshot = { ...map };
  folderWrite = folderWrite.then(async () => {
    try {
      await area.set({ [FOLDER_STATE_KEY]: snapshot });
    } catch {
      /* ignore */
    }
  });
  await folderWrite;
}

// 失效文件夹标记：reader 写入，popup 读取；与 folderState 一样存 local
let invalidCache: InvalidFolderMap | undefined;
let invalidPromise: Promise<InvalidFolderMap> | undefined;
let invalidWrite: Promise<void> = Promise.resolve();

async function readInvalidFolders(): Promise<InvalidFolderMap> {
  const area = getStorageArea('local');
  if (!area) return {};
  try {
    const stored = await area.get(INVALID_FOLDERS_KEY);
    const raw = stored?.[INVALID_FOLDERS_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const map: InvalidFolderMap = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const obj = value as Record<string, unknown>;
      const kind = obj['kind'];
      if (kind !== 'not-found' && kind !== 'permission' && kind !== 'unknown') continue;
      const at = typeof obj['at'] === 'number' && Number.isFinite(obj['at']) ? obj['at'] : 0;
      map[name] = { kind, at };
    }
    return map;
  } catch {
    return {};
  }
}

async function getInvalidFolders(): Promise<InvalidFolderMap> {
  if (invalidCache) return invalidCache;
  if (!invalidPromise) invalidPromise = readInvalidFolders();
  const map = await invalidPromise;
  invalidCache = map;
  invalidPromise = undefined;
  return map;
}

async function writeInvalidFolders(map: InvalidFolderMap): Promise<void> {
  const area = getStorageArea('local');
  if (!area) return;
  const snapshot = { ...map };
  invalidWrite = invalidWrite.then(async () => {
    try {
      await area.set({ [INVALID_FOLDERS_KEY]: snapshot });
    } catch {
      /* ignore */
    }
  });
  await invalidWrite;
}

export async function loadInvalidFolders(): Promise<InvalidFolderMap> {
  return { ...(await getInvalidFolders()) };
}

export async function markFolderInvalid(dir: string, kind: FolderErrorKind): Promise<void> {
  if (!dir) return;
  const map = await getInvalidFolders();
  map[dir] = { kind, at: Date.now() };
  await writeInvalidFolders(map);
}

/** 清除指定文件夹或全部失效标记 */
export async function clearInvalidFolders(names?: string[]): Promise<void> {
  const map = await getInvalidFolders();
  if (!names) {
    if (Object.keys(map).length === 0) return;
    invalidCache = {};
    await writeInvalidFolders({});
    return;
  }
  let changed = false;
  for (const name of names) {
    if (name in map) {
      delete map[name];
      changed = true;
    }
  }
  if (changed) await writeInvalidFolders(map);
}

export async function clearFolderInvalid(dir: string): Promise<void> {
  if (!dir) return;
  await clearInvalidFolders([dir]);
}
