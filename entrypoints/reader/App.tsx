import { useEffect, useRef, useState } from 'react';
import { scanTopLevelImages, type ImageEntry } from '@/utils/files';
import { saveLastDir, loadLastDir } from '@/utils/db';
import { doubleSpreadCount, spreadOfIndex, doubleIndices } from '@/utils/paging';
import ImageItem from '@/components/ImageItem';
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadLastZoom,
  saveLastZoom,
  type ReaderConfig,
  type ReaderMode,
} from '@/utils/config';
import { resolveLang, t, type Lang } from '@/utils/i18n';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const MODES: { key: ReaderMode; labelKey: string }[] = [
  { key: 'scroll', labelKey: 'modeScroll' },
  { key: 'single', labelKey: 'modeSingle' },
  { key: 'double', labelKey: 'modeDouble' },
];

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

export default function App() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [dirName, setDirName] = useState('');
  const [hasSubfolders, setHasSubfolders] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [lang, setLang] = useState<Lang>(resolveLang('system'));
  const [mode, setMode] = useState<ReaderMode>('scroll');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [barsVisible, setBarsVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState('50% 50%');

  // 已存句柄但权限待确认时，展示「重新授权」
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [reauthNeeded, setReauthNeeded] = useState(false);

  const stageRef = useRef<HTMLElement | null>(null);
  const lastFlipRef = useRef(0);
  const clickTimerRef = useRef<number | undefined>(undefined);

  const spreadCount = doubleSpreadCount(images.length);
  const currentSpread = spreadOfIndex(currentIndex);

  // 初始化配置 + 自动恢复最近文件夹
  useEffect(() => {
    void init();
  }, []);

  async function init() {
    const cfg = await loadConfig();
    document.documentElement.dataset.theme = cfg.theme;
    setConfig(cfg);
    setLang(resolveLang(cfg.lang));
    setMode(cfg.defaultMode);
    if (cfg.zoomDefault === 'memory') {
      const z = await loadLastZoom();
      if (z !== undefined) setZoom(clampZoom(z));
    }
    await restoreLastDir();
  }

  // 记忆上次缩放
  useEffect(() => {
    if (config.zoomDefault === 'memory') {
      void saveLastZoom(zoom);
    }
  }, [zoom, config.zoomDefault]);

  // 配置实时同步（主题/语言/快捷键等）
  useEffect(() => {
    function listener(changes: Record<string, unknown>) {
      const next = changes['config'] as ReaderConfig | undefined;
      if (!next) return;
      document.documentElement.dataset.theme = next.theme;
      setConfig(next);
      setLang(resolveLang(next.lang));
    }
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  // 键盘：翻页 + 隐藏/唤回状态栏
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const hideKey = (config.hideKey || 'f').toLowerCase();
      if (e.key.toLowerCase() === hideKey) {
        setBarsVisible((v) => !v);
        return;
      }
      if (mode === 'scroll') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // 滚轮：Ctrl+滚轮缩放（以鼠标为中心），普通滚轮翻页；原生监听支持 preventDefault
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        if (mode !== 'scroll') {
          const zoomable = (e.target as HTMLElement).closest?.('.zoomable') as HTMLElement | null;
          if (zoomable) {
            const rect = zoomable.getBoundingClientRect();
            setOrigin(`${e.clientX - rect.left}px ${e.clientY - rect.top}px`);
          }
        }
        setZoom((z) => clampZoom(z * factor));
        return;
      }
      if (mode === 'scroll') return;
      const now = Date.now();
      if (now - lastFlipRef.current < 350) return;
      if (Math.abs(e.deltaY) < 8) return;
      lastFlipRef.current = now;
      if (e.deltaY > 0) goNext();
      else goPrev();
    }
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  });

  async function restoreLastDir() {
    const handle = await loadLastDir();
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      await loadFromHandle(handle);
    } else if (perm === 'prompt') {
      setStoredHandle(handle);
      setReauthNeeded(true);
    }
  }

  async function loadFromHandle(handle: FileSystemDirectoryHandle) {
    setStatus('loading');
    setError('');
    try {
      const result = await scanTopLevelImages(handle);
      setImages(result.images);
      setHasSubfolders(result.hasSubfolders);
      setDirName(handle.name);
      setCurrentIndex(0);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError(String(e));
    }
  }

  async function importFolder() {
    try {
      const handle = await window.showDirectoryPicker();
      await saveLastDir(handle);
      setStoredHandle(null);
      setReauthNeeded(false);
      await loadFromHandle(handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setStatus('error');
      setError(String(e));
    }
  }

  async function reauthorize() {
    if (!storedHandle) return;
    const perm = await storedHandle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      setReauthNeeded(false);
      await loadFromHandle(storedHandle);
    }
  }

  function selectMode(next: ReaderMode) {
    setMode(next);
    setCurrentIndex((i) => Math.min(i, Math.max(images.length - 1, 0)));
  }

  function goPrev() {
    if (mode === 'single') {
      setCurrentIndex((i) => Math.max(i - 1, 0));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const prevSpread = Math.max(spreadOfIndex(i) - 1, 0);
        return doubleIndices(prevSpread, images.length)[0] ?? 0;
      });
    }
  }

  function goNext() {
    if (mode === 'single') {
      setCurrentIndex((i) => Math.min(i + 1, images.length - 1));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const nextSpread = Math.min(spreadOfIndex(i) + 1, doubleSpreadCount(images.length) - 1);
        return doubleIndices(nextSpread, images.length)[0] ?? i;
      });
    }
  }

  function resetZoom() {
    setZoom(1);
    setOrigin('50% 50%');
  }

  function onStageClick(e: React.MouseEvent) {
    if (mode === 'scroll' || zoom !== 1) return;
    const dir = e.clientX < window.innerWidth / 2 ? 'prev' : 'next';
    window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      if (dir === 'prev') goPrev();
      else goNext();
    }, 200);
  }

  function onStageDoubleClick() {
    window.clearTimeout(clickTimerRef.current);
    resetZoom();
  }

  function jumpTo(index: number) {
    setCurrentIndex(index);
    if (mode === 'scroll') {
      document.getElementById(`img-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const currentNames = (() => {
    if (mode === 'single') return [images[currentIndex]?.name ?? ''];
    if (mode === 'double') {
      return doubleIndices(currentSpread, images.length).map((i) => images[i]?.name ?? '');
    }
    return [];
  })();

  const pageInfo = (() => {
    if (mode === 'single') return `${currentIndex + 1} / ${images.length}`;
    if (mode === 'double') return `${currentSpread + 1} / ${spreadCount}`;
    return t(lang, 'imageCount', { n: images.length });
  })();

  return (
    <div className="reader">
      {barsVisible && (
        <header className="toolbar">
          <button className="toolbar__import" onClick={importFolder}>
            {t(lang, 'importFolder')}
          </button>
          {reauthNeeded && (
            <button className="toolbar__reauth" onClick={() => void reauthorize()}>
              {t(lang, 'reauth')}
            </button>
          )}
          {dirName && <span className="toolbar__dirname">{dirName}</span>}

          <div className="toolbar__modes" role="group" aria-label="reading mode">
            {MODES.map((m) => (
              <button
                key={m.key}
                className={`mode-btn${mode === m.key ? ' mode-btn--active' : ''}`}
                onClick={() => selectMode(m.key)}
              >
                {t(lang, m.labelKey)}
              </button>
            ))}
          </div>

          <button className="toolbar__restore" onClick={resetZoom}>
            {t(lang, 'restore')}
          </button>

          <button
            className="toolbar__hide"
            title={t(lang, 'hide')}
            onClick={() => setBarsVisible(false)}
          >
            {t(lang, 'hide')}
          </button>
        </header>
      )}

      <div className="reader__body">
        <aside className="dirlist">
          {status === 'loading' && <p className="hint">{t(lang, 'loading')}</p>}
          {status === 'idle' && <p className="hint">{t(lang, 'importPrompt')}</p>}
          {status === 'ready' && images.length === 0 && <p className="hint">{t(lang, 'noImages')}</p>}
          <ul className="dirlist__items">
            {images.map((img, index) => (
              <li
                key={img.name}
                className={`dirlist__item${
                  mode !== 'scroll' && index === currentIndex ? ' dirlist__item--active' : ''
                }`}
                title={img.name}
                onClick={() => jumpTo(index)}
              >
                {img.name}
              </li>
            ))}
          </ul>
        </aside>

        <main
          ref={stageRef}
          className={`stage stage--${mode}`}
          onClick={onStageClick}
          onDoubleClick={onStageDoubleClick}
        >
          {status === 'idle' && <p className="stage__empty">{t(lang, 'emptyHint')}</p>}
          {hasSubfolders && <p className="warning">{t(lang, 'subfolderWarning')}</p>}
          {error && <p className="error">{error}</p>}

          {status === 'ready' && mode === 'scroll' && (
            <div className="scroll">
              {images.map((img, index) => (
                <div key={img.name} id={`img-${index}`} className="scroll__item" style={{ zoom }}>
                  <ImageItem fileHandle={img.fileHandle} alt={img.name} lazy />
                </div>
              ))}
            </div>
          )}

          {status === 'ready' && mode === 'single' && (
            <div
              className="single zoomable"
              style={{ transform: `scale(${zoom})`, transformOrigin: origin }}
            >
              {images[currentIndex] && (
                <ImageItem
                  fileHandle={images[currentIndex].fileHandle}
                  alt={images[currentIndex].name}
                />
              )}
            </div>
          )}

          {status === 'ready' && mode === 'double' && (
            <div
              className="double zoomable"
              style={{ transform: `scale(${zoom})`, transformOrigin: origin }}
            >
              {doubleIndices(currentSpread, images.length).map((i) => (
                <div key={images[i]?.name} className="double__page">
                  {images[i] && (
                    <ImageItem fileHandle={images[i].fileHandle} alt={images[i].name} />
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {barsVisible && (
        <footer className="statusbar">
          <span className="statusbar__page">{pageInfo}</span>
          <span className="statusbar__name">{currentNames.filter(Boolean).join(' ｜ ')}</span>
          <span className="statusbar__zoom">{Math.round(zoom * 100)}%</span>
        </footer>
      )}

      {!barsVisible && (
        <>
          <div className="reveal reveal--top" onClick={() => setBarsVisible(true)}>
            <span className="reveal__handle">{t(lang, 'showBarsTop')}</span>
          </div>
          <div className="reveal reveal--bottom" onClick={() => setBarsVisible(true)}>
            <span className="reveal__handle">{t(lang, 'showBarsBottom')}</span>
          </div>
        </>
      )}
    </div>
  );
}