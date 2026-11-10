import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type ReaderConfig,
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

export default function App() {
  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<FileSystemDirectoryHandle[]>([]);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig();
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
      if (next) setConfig(next);
    }
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, []);

  const lang: Lang = resolveLang(config.lang);
  const hideKey = (config.hideKey || 'f').toUpperCase();

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
          <span className="row__label">{t(lang, 'hideKeyLabel')}</span>
          <input
            className="keycap"
            value={config.hideKey}
            maxLength={1}
            aria-label={t(lang, 'hideKeyLabel')}
            onChange={(e) => {
              const v = e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 1);
              void update({ hideKey: v || 'f' });
            }}
          />
        </div>
        <p className="row__hint">{t(lang, 'hideKeyHint')}</p>
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
        <span>{t(lang, 'footerHint', { key: hideKey })}</span>
      </footer>
    </div>
  );
}
