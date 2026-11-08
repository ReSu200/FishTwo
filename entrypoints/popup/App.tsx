import { useEffect, useState } from 'react';
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type ReaderConfig,
  type ReaderMode,
  type Theme,
  type ZoomDefault,
} from '@/utils/config';
import { resolveLang, t, type Lang, type LangSetting } from '@/utils/i18n';
import { loadLastDir } from '@/utils/db';

const MODE_OPTIONS: { value: ReaderMode; key: string }[] = [
  { value: 'scroll', key: 'modeScroll' },
  { value: 'single', key: 'modeSingle' },
  { value: 'double', key: 'modeDouble' },
];
const THEME_OPTIONS: { value: Theme; key: string }[] = [
  { value: 'light', key: 'themeLight' },
  { value: 'dark', key: 'themeDark' },
];
const ZOOM_OPTIONS: { value: ZoomDefault; key: string }[] = [
  { value: 'fixed', key: 'zoomFixed' },
  { value: 'memory', key: 'zoomMemory' },
];
const LANG_OPTIONS: { value: LangSetting; key: string }[] = [
  { value: 'system', key: 'langSystem' },
  { value: 'zh', key: 'langZh' },
  { value: 'en', key: 'langEn' },
];

export default function App() {
  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [recentName, setRecentName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setConfig(await loadConfig());
      const handle = await loadLastDir();
      setRecentName(handle?.name ?? null);
    })();
  }, []);

  const lang: Lang = resolveLang(config.lang);

  async function update(patch: Partial<ReaderConfig>) {
    const next = { ...config, ...patch };
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

  return (
    <div className="popup">
      <header className="popup__header">
        <h1 className="popup__title">{t(lang, 'name')}</h1>
        <button className="popup__open" onClick={openReader}>
          {t(lang, 'openReader')}
        </button>
      </header>

      <div className="field">
        <label className="field__label">{t(lang, 'langLabel')}</label>
        <select
          className="field__select"
          value={config.lang}
          onChange={(e) => void update({ lang: e.target.value as LangSetting })}
        >
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(lang, o.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label">{t(lang, 'defaultMode')}</label>
        <select
          className="field__select"
          value={config.defaultMode}
          onChange={(e) => void update({ defaultMode: e.target.value as ReaderMode })}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(lang, o.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label">{t(lang, 'theme')}</label>
        <select
          className="field__select"
          value={config.theme}
          onChange={(e) => void update({ theme: e.target.value as Theme })}
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(lang, o.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label">{t(lang, 'defaultZoom')}</label>
        <select
          className="field__select"
          value={config.zoomDefault}
          onChange={(e) => void update({ zoomDefault: e.target.value as ZoomDefault })}
        >
          {ZOOM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(lang, o.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label">{t(lang, 'hideKeyLabel')}</label>
        <input
          className="field__input"
          value={config.hideKey}
          maxLength={2}
          onChange={(e) => void update({ hideKey: e.target.value })}
        />
      </div>

      <div className="recent">
        <div className="recent__label">{t(lang, 'recentFolders')}</div>
        {recentName ? (
          <div className="recent__row">
            <span className="recent__name">{recentName}</span>
            <button className="recent__open" onClick={openReader}>
              {t(lang, 'open')}
            </button>
          </div>
        ) : (
          <div className="recent__none">{t(lang, 'recentNone')}</div>
        )}
      </div>
    </div>
  );
}