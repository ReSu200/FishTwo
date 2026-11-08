import { useEffect, useState } from 'react';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type ReaderConfig } from '@/utils/config';
import { resolveLang, t, type Lang, type LangSetting } from '@/utils/i18n';
import { loadDirHistory, saveLastDir } from '@/utils/db';

const LANG_OPTIONS: { value: LangSetting; key: string }[] = [
  { value: 'system', key: 'langSystem' },
  { value: 'zh', key: 'langZh' },
  { value: 'en', key: 'langEn' },
];

export default function App() {
  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<FileSystemDirectoryHandle[]>([]);

  useEffect(() => {
    void (async () => {
      setConfig(await loadConfig());
      setHistory(await loadDirHistory());
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
        {history.length > 0 ? (
          <ul className="recent__list">
            {history.map((h, i) => (
              <li key={`${h.name}-${i}`} className="recent__row">
                <span className="recent__name" title={h.name}>
                  {h.name}
                </span>
                <button className="recent__open" onClick={() => void openDir(h)}>
                  {t(lang, 'open')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="recent__none">{t(lang, 'recentNone')}</div>
        )}
      </div>
    </div>
  );
}
