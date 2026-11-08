import { useCallback, useEffect, useRef, useState } from 'react';
import { scanTopLevelImages, type ImageEntry } from '@/utils/files';
import { saveLastDir, loadLastDir } from '@/utils/db';
import { doubleSpreadCount, spreadOfIndex, doubleIndices } from '@/utils/paging';
import ImageItem from '@/components/ImageItem';
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadLastPosition,
  loadLastZoom,
  saveConfig,
  saveLastPosition,
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

/** 计算缩放为 s 时使内容居中所需的平移量（相对 stage 内容区，原点在左上角） */
function centeredOffset(stage: HTMLElement | null, s: number) {
  if (!stage || s === 1) return { x: 0, y: 0 };
  const r = stage.getBoundingClientRect();
  const cs = getComputedStyle(stage);
  const w = r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const h = r.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  return { x: (w / 2) * (1 - s), y: (h / 2) * (1 - s) };
}

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
  const [dirVisible, setDirVisible] = useState(true);
  // 单/双页视图：s=缩放比例，x/y=平移量（相对 stage 内容区左上角，transform-origin 固定为左上角）
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  // 下拉滚动的阅读进度百分比
  const [scrollProgress, setScrollProgress] = useState(0);

  // 已存句柄但权限待确认时，展示「重新授权」
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [reauthNeeded, setReauthNeeded] = useState(false);

  const stageRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFlipRef = useRef(0);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const spreadCount = doubleSpreadCount(images.length);
  const currentSpread = spreadOfIndex(currentIndex);

  // 翻页逻辑（键盘/滚轮/点击共享；useCallback 稳定引用以配合 effect 依赖）
  const goPrev = useCallback(() => {
    if (mode === 'single') {
      setCurrentIndex((i) => Math.max(i - 1, 0));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const prevSpread = Math.max(spreadOfIndex(i) - 1, 0);
        return doubleIndices(prevSpread, images.length)[0] ?? 0;
      });
    }
    setView((v) => ({ s: v.s, ...centeredOffset(stageRef.current, v.s) }));
  }, [mode, images.length]);

  const goNext = useCallback(() => {
    if (mode === 'single') {
      setCurrentIndex((i) => Math.min(i + 1, images.length - 1));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const nextSpread = Math.min(spreadOfIndex(i) + 1, doubleSpreadCount(images.length) - 1);
        return doubleIndices(nextSpread, images.length)[0] ?? i;
      });
    }
    setView((v) => ({ s: v.s, ...centeredOffset(stageRef.current, v.s) }));
  }, [mode, images.length]);

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
      if (z !== undefined) setView((v) => ({ ...v, s: clampZoom(z) }));
    }
    await restoreLastDir();
  }

  // 记忆上次缩放
  useEffect(() => {
    if (config.zoomDefault === 'memory') {
      void saveLastZoom(view.s);
    }
  }, [view.s, config.zoomDefault]);

  // 配置实时同步（主题/语言/快捷键等）
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
      const change = changes['config'] as { newValue?: ReaderConfig } | undefined;
      const next = change?.newValue;
      if (!next) return;
      document.documentElement.dataset.theme = next.theme;
      setConfig(next);
      setLang(resolveLang(next.lang));
    }
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, []);

  // 键盘：翻页 + 隐藏/唤回状态栏
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const hideKey = (config.hideKey || 'f').toLowerCase();
      if (e.key.toLowerCase() === hideKey) {
        // 沉浸模式：隐藏状态栏时一并隐藏目录，显示时一并恢复
        const next = !barsVisible;
        setBarsVisible(next);
        setDirVisible(next);
        return;
      }
      if (e.key.toLowerCase() === 'd') {
        setDirVisible((v) => !v);
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
  }, [config.hideKey, mode, goPrev, goNext, barsVisible]);

  // 滚轮：Ctrl+滚轮缩放（以鼠标为中心），普通滚轮翻页；原生监听支持 preventDefault
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        if (mode === 'scroll') {
          setView((v) => ({ ...v, s: clampZoom(v.s * factor) }));
          return;
        }
        // 单/双页：以鼠标点为中心缩放（固定左上角原点 + 精确平移补偿，避免锚点漂移）
        const stageEl = stageRef.current;
        if (!stageEl) return;
        const sr = stageEl.getBoundingClientRect();
        const cs = getComputedStyle(stageEl);
        const mx = e.clientX - (sr.left + (parseFloat(cs.paddingLeft) || 0));
        const my = e.clientY - (sr.top + (parseFloat(cs.paddingTop) || 0));
        setView((v) => {
          const s2 = clampZoom(v.s * factor);
          const cx = (mx - v.x) / v.s;
          const cy = (my - v.y) / v.s;
          return { s: s2, x: mx - s2 * cx, y: my - s2 * cy };
        });
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
  }, [mode, goPrev, goNext]);

  // 单/双页缩放后拖拽平移（仅 zoom>1 时生效）
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setView((v) => ({
        ...v,
        x: drag.originX + (e.clientX - drag.startX),
        y: drag.originY + (e.clientY - drag.startY),
      }));
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 下拉滚动模式：随滚动更新当前图片索引，实现目录高亮与阅读进度双向同步
  useEffect(() => {
    if (mode !== 'scroll' || status !== 'ready') return;
    const root = stageRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (!first) return;
        const idx = Number((first.target as HTMLElement).dataset.index);
        if (!Number.isNaN(idx)) setCurrentIndex(idx);
      },
      { root, rootMargin: '0px 0px -50% 0px', threshold: 0 },
    );
    root.querySelectorAll('.scroll__item').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [mode, status, images]);

  // 记忆阅读位置：同一文件夹下次打开恢复到上次所在图片
  useEffect(() => {
    if (dirName && status === 'ready') {
      void saveLastPosition({ dir: dirName, index: currentIndex });
    }
  }, [currentIndex, dirName, status]);

  // 下拉滚动模式：计算阅读进度百分比
  useEffect(() => {
    if (mode !== 'scroll' || status !== 'ready') return;
    const el = stageRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const p = max > 0 ? Math.round((el.scrollTop / max) * 100) : 100;
      setScrollProgress(Math.max(0, Math.min(100, p)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [mode, status, images]);

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
      // 恢复上次阅读位置（仅当同一文件夹且索引有效）
      let startIndex = 0;
      const pos = await loadLastPosition();
      if (pos && pos.dir === handle.name && pos.index >= 0 && pos.index < result.images.length) {
        startIndex = pos.index;
      }
      setCurrentIndex(startIndex);
      setStatus('ready');
      if (startIndex > 0) {
        window.setTimeout(() => {
          document.getElementById(`img-${startIndex}`)?.scrollIntoView({ block: 'start' });
        }, 120);
      }
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
    setView((v) => ({ s: v.s, ...centeredOffset(stageRef.current, v.s) }));
  }

  function resetZoom() {
    setView({ s: 1, x: 0, y: 0 });
  }

  function toggleTheme() {
    const next: ReaderConfig['theme'] = config.theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      const nextCfg = { ...config, theme: next };
      setConfig(nextCfg);
      void saveConfig(nextCfg);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  }

  function onStageClick(e: React.MouseEvent) {
    if (mode === 'scroll' || view.s !== 1) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dir = e.clientX < rect.left + rect.width / 2 ? 'prev' : 'next';
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

  function onZoomableMouseDown(e: React.MouseEvent) {
    if (mode === 'scroll' || view.s <= 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: view.x,
      originY: view.y,
    };
    e.preventDefault();
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
    return `${scrollProgress}%`;
  })();

  // 目录栏高亮索引集合：双页模式高亮整屏，其余模式高亮当前项
  const activeIndices = (() => {
    if (mode === 'double') return new Set(doubleIndices(currentSpread, images.length));
    return new Set([currentIndex]);
  })();

  return (
    <div className="reader">
      {barsVisible && (
        <header className="toolbar">
          <button className="toolbar__import" onClick={importFolder}>
            {t(lang, 'importFolder')}
          </button>
          <button
            className="toolbar__dir"
            title={t(lang, 'dirHint')}
            onClick={() => setDirVisible((v) => !v)}
          >
            {t(lang, dirVisible ? 'hideDir' : 'showDir')}
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
            className="toolbar__theme"
            title={t(lang, 'themeToggle')}
            onClick={toggleTheme}
          >
            {config.theme === 'dark' ? '☀' : '☾'}
          </button>

          <button
            className="toolbar__hide"
            title={t(lang, 'hide')}
            onClick={() => {
              setBarsVisible(false);
              setDirVisible(false);
            }}
          >
            {t(lang, 'hide')}
          </button>
        </header>
      )}

      <div className="reader__body">
        <aside className={`dirlist${dirVisible ? '' : ' dirlist--hidden'}`}>
          {status === 'loading' && <p className="hint">{t(lang, 'loading')}</p>}
          {status === 'idle' && <p className="hint">{t(lang, 'importPrompt')}</p>}
          {status === 'ready' && images.length === 0 && <p className="hint">{t(lang, 'noImages')}</p>}
          <ul className="dirlist__items">
            {images.map((img, index) => (
              <li
                key={img.name}
                className={`dirlist__item${activeIndices.has(index) ? ' dirlist__item--active' : ''}`}
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
            <div ref={scrollRef} className="scroll">
              {images.map((img, index) => (
                <div key={img.name} id={`img-${index}`} data-index={index} className="scroll__item" style={{ zoom: view.s }}>
                  <ImageItem fileHandle={img.fileHandle} alt={img.name} lazy />
                </div>
              ))}
            </div>
          )}

          {status === 'ready' && mode === 'single' && (
            <div
              className="single zoomable"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
                transformOrigin: '0 0',
                cursor: view.s > 1 ? 'grab' : undefined,
              }}
              onMouseDown={onZoomableMouseDown}
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
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
                transformOrigin: '0 0',
                cursor: view.s > 1 ? 'grab' : undefined,
              }}
              onMouseDown={onZoomableMouseDown}
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
          <span className="statusbar__zoom">{Math.round(view.s * 100)}%</span>
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