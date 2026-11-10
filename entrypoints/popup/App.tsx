import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  DEFAULT_SHORTCUTS,
  isReservedShortcutKey,
  loadConfig,
  normalizeShortcuts,
  saveConfig,
  type ReaderConfig,
  type ShortcutAction,
  type Theme,
} from '@/utils/config';
import { resolveLang, t, type Lang, type LangSetting } from '@/utils/i18n';
import { loadDirHistory, saveLastDir } from '@/utils/db';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';

const LANG_OPTIONS: { value: LangSetting; key: string }[] = [
  { value: 'system', key: 'langSystem' },
  { value: 'zh', key: 'langZh' },
  { value: 'en', key: 'langEn' },
];

const THEME_OPTIONS: { value: Theme; key: string; icon: 'sun' | 'moon' }[] = [
  { value: 'light', key: 'themeLight', icon: 'sun' },
  { value: 'dark', key: 'themeDark', icon: 'moon' },
];

const MODE_OPTIONS: { value: ReaderConfig['defaultMode']; key: string }[] = [
  { value: 'scroll', key: 'modeScroll' },
  { value: 'single', key: 'modeSingle' },
  { value: 'double', key: 'modeDouble' },
];

const ZOOM_OPTIONS: { value: ReaderConfig['zoomDefault']; key: string }[] = [
  { value: 'fixed', key: 'zoomFixed' },
  { value: 'memory', key: 'zoomMemory' },
];

const SHORTCUT_ROWS: { action: ShortcutAction; labelKey: string }[] = [
  { action: 'dir', labelKey: 'shortcutDir' },
  { action: 'immersive', labelKey: 'shortcutImmersive' },
  { action: 'fullscreen', labelKey: 'shortcutFullscreen' },
];

export default function App() {
  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<FileSystemDirectoryHandle[]>([]);
  const [version, setVersion] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [conflictKey, setConflictKey] = useState('');

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig();
      configRef.current = cfg;
      setConfig(cfg);
      setHistory(await loadDirHistory());
    })();
    try {
      setVersion(chrome.runtime.getManifest().version);
    } catch {
      /* 非扩展环境下忽略 */
    }
  }, []);

  // 主题跟随配置，实时反映到弹窗
  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
  }, [config.theme]);

  // 阅读器中切换主题 / 语言时同步到弹窗
  useEffect(() => {
    const onChanged = (() => {
      try {
        return typeof chrome !== 'undefined' && chrome?.storage?.onChanged ? chrome.storage.onChanged : null;
      } catch {
        return null;
      }
    })();
    if (!onChanged) return;
    function listener(changes: Record<string, unknown>) {
      const next = (changes['config'] as { newValue?: ReaderConfig } | undefined)?.newValue;
      if (next) {
        const safe: ReaderConfig = {
          ...next,
          shortcuts: normalizeShortcuts(next.shortcuts, next.hideKey),
        };
        configRef.current = safe;
        setConfig(safe);
      }
    }
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, []);

  const lang: Lang = resolveLang(config.lang);
  const immersiveKey = (config.shortcuts.immersive || 'f').toUpperCase();

  // 用 ref 持有最新配置：连续修改（如逐字输入快捷键）时不依赖渲染期闭包，避免丢失字段
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  async function update(patch: Partial<ReaderConfig>) {
    const next = { ...configRef.current, ...patch };
    configRef.current = next;
    setConfig(next);
    await saveConfig(next);
  }

  function changeShortcut(action: ShortcutAction, raw: string) {
    const key = raw.replace(/[^a-zA-Z]/g, '').slice(0, 1).toLowerCase();
    if (!key) return;
    if (isReservedShortcutKey(key)) {
      setConflictKey(key);
      return;
    }
    const current = configRef.current.shortcuts;
    if (SHORTCUT_ROWS.some((row) => row.action !== action && current[row.action] === key)) {
      setConflictKey(key);
      return;
    }
    setConflictKey('');
    void update({ shortcuts: { ...current, [action]: key } });
  }

  function openReader() {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('/reader.html') });
    } catch (e) {
      console.error('Failed to open reader', e);
    }
  }

  async function openDir(handle: FileSystemDirectoryHandle) {
    try {
      // 置顶为最近打开，阅读器打开时会自动恢复该目录
      await saveLastDir(handle);
    } catch (e) {
      console.error(e);
    }
    openReader();
  }

  return (
    <div className="popup">
      <header className="popup__head">
        <Logo size={32} />
        <div className="popup__brand">
          <span className="popup__name">{t(lang, 'name')}</span>
          <span className="popup__sub">{t(lang, 'subtitle')}</span>
        </div>
        {version && <span className="pill">v{version}</span>}
      </header>

      <button className="cta" onClick={openReader}>
        <span className="cta__icon">
          <Icon name="folderPlus" size={18} />
        </span>
        <span className="cta__text">
          <span className="cta__title">{t(lang, 'openReader')}</span>
          <span className="cta__sub">{t(lang, 'ctaSub')}</span>
        </span>
        <Icon name="arrowRight" size={16} />
      </button>

      <section className="group">
        <div className="group__head">
          <span className="group__title">{t(lang, 'settings')}</span>
        </div>

        <div className="row">
          <span className="row__label">{t(lang, 'langLabel')}</span>
          <div className="select">
            <select
              className="select__input"
              value={config.lang}
              onChange={(e) => void update({ lang: e.target.value as LangSetting })}
              aria-label={t(lang, 'langLabel')}
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(lang, o.key)}
                </option>
              ))}
            </select>
            <Icon className="select__arrow" name="chevronDown" size={14} />
          </div>
        </div>

        <div className="row">
          <span className="row__label">{t(lang, 'theme')}</span>
          <div className="theme" role="group" aria-label={t(lang, 'theme')}>
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`theme__btn${config.theme === o.value ? ' theme__btn--active' : ''}`}
                onClick={() => void update({ theme: o.value })}
                aria-pressed={config.theme === o.value}
              >
                <Icon name={o.icon} size={14} />
                {t(lang, o.key)}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <span className="row__label">{t(lang, 'defaultMode')}</span>
          <div className="select">
            <select
              className="select__input"
              value={config.defaultMode}
              onChange={(e) =>
                void update({ defaultMode: e.target.value as ReaderConfig['defaultMode'] })
              }
              aria-label={t(lang, 'defaultMode')}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(lang, o.key)}
                </option>
              ))}
            </select>
            <Icon className="select__arrow" name="chevronDown" size={14} />
          </div>
        </div>

        <div className="row">
          <span className="row__label">{t(lang, 'defaultZoom')}</span>
          <div className="select">
            <select
              className="select__input"
              value={config.zoomDefault}
              onChange={(e) =>
                void update({ zoomDefault: e.target.value as ReaderConfig['zoomDefault'] })
              }
              aria-label={t(lang, 'defaultZoom')}
            >
              {ZOOM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(lang, o.key)}
                </option>
              ))}
            </select>
            <Icon className="select__arrow" name="chevronDown" size={14} />
          </div>
        </div>

        <button
          className="group__toggle"
          onClick={() => {
            setShortcutsOpen((v) => !v);
            setConflictKey('');
          }}
          aria-expanded={shortcutsOpen}
        >
          <span className="group__title">{t(lang, 'shortcutsTitle')}</span>
          <Icon
            className={`group__chev${shortcutsOpen ? ' group__chev--open' : ''}`}
            name="chevronDown"
            size={14}
          />
        </button>

        {shortcutsOpen && (
          <div className="shortcut-list">
            {SHORTCUT_ROWS.map((row) => (
              <div className="row" key={row.action}>
                <span className="row__label">{t(lang, row.labelKey)}</span>
                <input
                  className="keycap"
                  value={config.shortcuts[row.action].toUpperCase()}
                  maxLength={1}
                  aria-label={t(lang, row.labelKey)}
                  onChange={(e) => changeShortcut(row.action, e.target.value)}
                />
              </div>
            ))}
            {conflictKey && (
              <p className="row__hint row__hint--warn">
                {t(lang, 'shortcutConflict', { key: conflictKey.toUpperCase() })}
              </p>
            )}
            <p className="row__hint">{t(lang, 'shortcutReserved')}</p>
            <p className="row__hint">{t(lang, 'shortcutHint')}</p>
            <button
              className="shortcut-reset"
              onClick={() => {
                setConflictKey('');
                void update({ shortcuts: { ...DEFAULT_SHORTCUTS } });
              }}
            >
              {t(lang, 'shortcutReset')}
            </button>
          </div>
        )}
      </section>

      <section className="group group--recent">
        <div className="group__head">
          <span className="group__title">{t(lang, 'recentFolders')}</span>
          <span className="group__count">{history.length > 0 ? history.length : ''}</span>
        </div>

        {history.length > 0 ? (
          <ul className="recent-list">
            {history.map((h, i) => (
              <li key={`${h.name}-${i}`}>
                <button className="recent" onClick={() => void openDir(h)} title={h.name}>
                  <Icon className="recent__icon" name="folder" size={15} />
                  <span className="recent__name">{h.name}</span>
                  <Icon className="recent__arrow" name="chevronRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="recent-none">{t(lang, 'recentNone')}</div>
        )}
      </section>

      <footer className="popup__foot">
        <span>{t(lang, 'footerHint', { key: immersiveKey })}</span>
      </footer>
    </div>
  );
}
