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

export async function loadConfig(): Promise<ReaderConfig> {
  const stored = await browser.storage.sync.get(CONFIG_KEY);
  const raw = (stored?.[CONFIG_KEY] ?? {}) as Partial<ReaderConfig>;
  return { ...DEFAULT_CONFIG, ...raw };
}

export async function saveConfig(config: ReaderConfig): Promise<void> {
  await browser.storage.sync.set({ [CONFIG_KEY]: config });
}

export async function loadLastZoom(): Promise<number | undefined> {
  const stored = await browser.storage.local.get(LAST_ZOOM_KEY);
  const v = stored?.[LAST_ZOOM_KEY];
  return typeof v === 'number' ? v : undefined;
}

export async function saveLastZoom(zoom: number): Promise<void> {
  await browser.storage.local.set({ [LAST_ZOOM_KEY]: zoom });
}