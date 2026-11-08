import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanTopLevelImages, type ImageEntry } from '@/utils/files';
import { saveLastDir, loadLastDir } from '@/utils/db';
import { doubleSpreadCount, spreadOfIndex, doubleIndices } from '@/utils/paging';
import ImageItem from '@/components/ImageItem';
import Icon, { type IconName } from '@/components/Icon';
import Logo from '@/components/Logo';
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

const MODES: { key: ReaderMode; labelKey: string; icon: IconName }[] = [
  { key: 'scroll', labelKey: 'modeScroll', icon: 'modeScroll' },
  { key: 'single', labelKey: 'modeSingle', icon: 'modeSingle' },
  { key: 'double', labelKey: 'modeDouble', icon: 'modeDouble' },
];

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

interface View {
  s: number;
  x: number;
  y: number;
}

/** 计算缩放为 s 时使内容居中所需的平移量（相对 stage 内容区，原点在左上角） */
function centeredOffset(stage: HTMLElement | null, s: number) {
  if (!stage || s === 1) return { x: 0, y: 0 };
  const r = stage.getBoundingClientRect();
  const cs = getComputedStyle(stage);
  const w = r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const h = r.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  return { x: (w / 2) * (1 - s), y: (h / 2) * (1 - s) };
}

/** 以内容坐标 (mx,my) 为锚点缩放，避免锚点漂移 */
function zoomAround(v: View, mx: number, my: number, factor: number): View {
  const s = clampZoom(v.s * factor);
  const cx = (mx - v.x) / v.s;
  const cy = (my - v.y) / v.s;
  return { s, x: mx - s * cx, y: my - s * cy };
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function App() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [dirName, setDirName] = useState('');
  const [hasSubfolders, setHasSubfolders] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const [config, setConfig] = useState<ReaderConfig>(DEFAULT_CONFIG);
  const [lang, setLang] = useState<Lang>(resolveLang('system'));
  const [mode, setMode] = useState<ReaderMode>('scroll');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [barsVisible, setBarsVisible] = useState(true);
  const [dirVisible, setDirVisible] = useState(true);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [dirQuery, setDirQuery] = useState('');
  // 单/双页视图：s=缩放比例，x/y=平移量（相对 stage 内容区左上角，transform-origin 固定为左上角）
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
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
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  // 目录跳转的校正序号：用户主动滚动/按键时递增，使未执行的校正失效
  const jumpSeqRef = useRef(0);

  const spreadCount = doubleSpreadCount(images.length);
  const currentSpread = spreadOfIndex(currentIndex);
  const hideKey = (config.hideKey || 'f').toUpperCase();

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

  // 标签页标题随语言切换
  useEffect(() => {
    document.title = `${t(lang, 'name')} · ${t(lang, 'reader')}`;
  }, [lang]);

  // 键盘：翻页 + 隐藏/唤回状态栏 + 快捷键面板
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (hintsOpen) {
          e.preventDefault();
          setHintsOpen(false);
        }
        return;
      }
      // 搜索框等输入场景不拦截按键
      if (isTypingTarget(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHintsOpen((v) => !v);
        return;
      }
      // 快捷键面板打开时，除 Esc / ? 外不响应其它按键
      if (hintsOpen) return;

      if (e.key.toLowerCase() === (config.hideKey || 'f').toLowerCase()) {
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
  }, [config.hideKey, mode, goPrev, goNext, barsVisible, hintsOpen]);

  // 滚轮：Ctrl+滚轮缩放（以鼠标为中心），普通滚轮翻页；原生监听支持 preventDefault
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      // 用户主动滚轮时取消目录跳转的后续校正
      jumpSeqRef.current += 1;
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
        setView((v) => zoomAround(v, mx, my, factor));
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

  // 下拉滚动模式：随滚动更新当前图片索引，实现目录高亮与阅读进度双向同步。
  // 说明：不用 IntersectionObserver（其回调只包含「变化」的条目，图片懒加载改变高度时
  // 会漏掉真正的顶部图片），改为按元素位置二分查找当前视口顶部的图片。
  useEffect(() => {
    if (mode !== 'scroll' || status !== 'ready') return;
    const root = stageRef.current;
    if (!root) return;
    let raf = 0;

    const compute = () => {
      raf = 0;
      const items = root.querySelectorAll<HTMLElement>('.scroll__item');
      if (items.length === 0) return;
      const rootTop = root.getBoundingClientRect().top + (parseFloat(getComputedStyle(root).paddingTop) || 0);
      let lo = 0;
      let hi = items.length - 1;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const item = items[mid];
        if (!item) break;
        const top = item.getBoundingClientRect().top;
        if (top <= rootTop + 4) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setCurrentIndex(best);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    const inner = root.querySelector('.scroll');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (inner) ro?.observe(inner);

    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    compute();

    return () => {
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
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

  // 目录栏：当前项保持在可视区域内
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, dirQuery, dirVisible]);

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
    setWarningDismissed(false);
    setDirQuery('');
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
        // 图片为懒加载，先滚动一次后等其高度确定再校正一次，避免落点偏移
        window.setTimeout(() => scrollToImage(startIndex, 'auto'), 120);
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

  /** 以舞台中心为锚点缩放（状态栏按钮） */
  function zoomBy(factor: number) {
    if (mode === 'scroll') {
      setView((v) => ({ ...v, s: clampZoom(v.s * factor) }));
      return;
    }
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const mx = (r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)) / 2;
    const my = (r.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)) / 2;
    setView((v) => zoomAround(v, mx, my, factor));
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
    if (mode === 'scroll' || view.s !== 1 || images.length === 0) return;
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

  /** 滚动定位到指定图片：图片懒加载会改变高度，故分多次校正落点（用户滚动/按键会取消） */
  function scrollToImage(index: number, behavior: ScrollBehavior = 'smooth') {
    const seq = ++jumpSeqRef.current;
    const scroll = () => {
      if (jumpSeqRef.current !== seq) return;
      document.getElementById(`img-${index}`)?.scrollIntoView({ behavior, block: 'start' });
    };
    [0, 350, 800, 1300].forEach((delay) => window.setTimeout(scroll, delay));
  }

  function jumpTo(index: number) {
    setCurrentIndex(index);
    if (mode === 'scroll') {
      scrollToImage(index);
    }
  }

  const filtered = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    return images
      .map((img, index) => ({ img, index }))
      .filter(({ img }) => !q || img.name.toLowerCase().includes(q));
  }, [images, dirQuery]);

  const currentNames = (() => {
    if (mode === 'single') return [images[currentIndex]?.name ?? ''];
    if (mode === 'double') {
      return doubleIndices(currentSpread, images.length).map((i) => images[i]?.name ?? '');
    }
    return [images[currentIndex]?.name ?? ''];
  })();

  const pageInfo = (() => {
    if (images.length === 0) return '0 / 0';
    if (mode === 'single') return `${currentIndex + 1} / ${images.length}`;
    if (mode === 'double') return `${currentSpread + 1} / ${spreadCount}`;
    return `${scrollProgress}%`;
  })();

  const canPrev = mode === 'single' ? currentIndex > 0 : currentSpread > 0;
  const canNext =
    mode === 'single' ? currentIndex < images.length - 1 : currentSpread < spreadCount - 1;

  // 目录栏高亮索引集合：双页模式高亮整屏，其余模式高亮当前项
  const activeIndices = (() => {
    if (mode === 'double') return new Set(doubleIndices(currentSpread, images.length));
    return new Set([currentIndex]);
  })();

  const activeModeIndex = Math.max(
    MODES.findIndex((m) => m.key === mode),
    0,
  );

  return (
    <div className="reader">
      {barsVisible && (
        <header className="toolbar">
          <div className="toolbar__group toolbar__group--left">
            <span className="brand">
              <Logo size={24} />
              <span className="brand__name">{t(lang, 'name')}</span>
            </span>

            <button className="btn btn--primary" onClick={importFolder}>
              <Icon name="folderPlus" size={15} />
              {t(lang, 'importFolder')}
            </button>

            {dirName && (
              <span className="chip" title={dirName}>
                <Icon name="folder" size={13} />
                <span className="chip__text">{dirName}</span>
              </span>
            )}

            {reauthNeeded && (
              <button className="btn btn--warn" onClick={() => void reauthorize()}>
                <Icon name="alert" size={14} />
                {t(lang, 'reauth')}
              </button>
            )}
          </div>

          <div className="toolbar__group toolbar__group--center">
            <div className="segmented" role="group" aria-label="reading mode">
              <span
                className="segmented__thumb"
                style={{ transform: `translateX(${activeModeIndex * 100}%)` }}
              />
              {MODES.map((m) => (
                <button
                  key={m.key}
                  className={`segmented__btn${mode === m.key ? ' segmented__btn--active' : ''}`}
                  onClick={() => selectMode(m.key)}
                  aria-pressed={mode === m.key}
                >
                  <Icon name={m.icon} size={14} />
                  <span className="segmented__label">{t(lang, m.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar__group toolbar__group--right">
            <button
              className={`icon-btn${dirVisible ? ' icon-btn--active' : ''}`}
              title={t(lang, 'dirHint')}
              aria-label={t(lang, dirVisible ? 'hideDir' : 'showDir')}
              onClick={() => setDirVisible((v) => !v)}
            >
              <Icon name="sidebar" size={17} />
            </button>
            <button
              className="icon-btn"
              title={`${t(lang, 'themeToggle')} · ${t(lang, config.theme === 'dark' ? 'themeLight' : 'themeDark')}`}
              aria-label={t(lang, 'themeToggle')}
              onClick={toggleTheme}
            >
              <Icon name={config.theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
            <button
              className="icon-btn"
              title={`${t(lang, 'shortcuts')} (?)`}
              aria-label={t(lang, 'shortcuts')}
              onClick={() => setHintsOpen(true)}
            >
              <Icon name="help" size={17} />
            </button>
            <button
              className="icon-btn"
              title={`${t(lang, 'hide')} (${hideKey})`}
              aria-label={t(lang, 'hide')}
              onClick={() => {
                setBarsVisible(false);
                setDirVisible(false);
              }}
            >
              <Icon name="eyeOff" size={17} />
            </button>
          </div>
        </header>
      )}

      <div className="reader__body">
        <aside className={`dirlist${dirVisible ? '' : ' dirlist--hidden'}`}>
          <div className="dirlist__head">
            <span className="dirlist__title">{t(lang, 'fileList')}</span>
            <span className="dirlist__count">{t(lang, 'imageCount', { n: images.length })}</span>
          </div>

          <div className="dirlist__search">
            <Icon name="search" size={14} />
            <input
              className="dirlist__input"
              value={dirQuery}
              onChange={(e) => setDirQuery(e.target.value)}
              placeholder={t(lang, 'searchPlaceholder')}
              aria-label={t(lang, 'searchPlaceholder')}
              spellCheck={false}
            />
            {dirQuery && (
              <button
                className="dirlist__clear"
                onClick={() => setDirQuery('')}
                aria-label={t(lang, 'close')}
                title={t(lang, 'close')}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>

          {status === 'loading' && <p className="hint">{t(lang, 'loading')}</p>}
          {status === 'idle' && <p className="hint">{t(lang, 'importPrompt')}</p>}
          {status === 'ready' && images.length === 0 && <p className="hint">{t(lang, 'noImages')}</p>}
          {status === 'ready' && images.length > 0 && filtered.length === 0 && (
            <p className="hint">{t(lang, 'searchEmpty')}</p>
          )}

          <ul className="dirlist__items">
            {filtered.map(({ img, index }) => {
              const active = activeIndices.has(index);
              return (
                <li key={img.name}>
                  <button
                    ref={active ? activeItemRef : undefined}
                    className={`dirlist__item${active ? ' dirlist__item--active' : ''}`}
                    title={img.name}
                    onClick={() => jumpTo(index)}
                  >
                    <span className="dirlist__no">{String(index + 1).padStart(2, '0')}</span>
                    <span className="dirlist__name">{img.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main
          ref={stageRef}
          className={`stage stage--${mode}`}
          onClick={onStageClick}
          onDoubleClick={onStageDoubleClick}
        >
          {status === 'idle' && (
            <div className="empty">
              <svg className="empty__art" viewBox="0 0 160 120" aria-hidden="true">
                <rect x="18" y="26" width="94" height="70" rx="10" fill="currentColor" opacity=".07" />
                <rect x="30" y="16" width="94" height="70" rx="10" fill="currentColor" opacity=".1" />
                <rect x="44" y="8" width="94" height="70" rx="10" fill="currentColor" opacity=".14" />
                <path
                  d="M70 40c4.2 5.6 9.3 8.4 15.2 8.4 5.1 0 9.2-3.7 9.2-8.4s-4.1-8.4-9.2-8.4c-5.9 0-11 2.8-15.2 8.4z"
                  fill="var(--accent)"
                  opacity=".55"
                />
                <path d="M70.6 40 64 34v12z" fill="var(--accent)" opacity=".55" />
                <circle cx="89" cy="38" r="1.6" fill="var(--panel)" />
                <path d="M56 62h50M56 70h34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".16" />
              </svg>
              <h2 className="empty__title">{t(lang, 'emptyTitle')}</h2>
              <p className="empty__desc">{t(lang, 'emptyDesc')}</p>
              <div className="empty__actions">
                <button className="btn btn--primary btn--lg" onClick={importFolder}>
                  <Icon name="folderPlus" size={16} />
                  {t(lang, 'importFolder')}
                </button>
              </div>
              <p className="empty__hint">{t(lang, 'emptySupport')}</p>
            </div>
          )}

          {status === 'loading' && (
            <div className="empty">
              <span className="spinner" aria-hidden="true" />
              <p className="empty__desc">{t(lang, 'loading')}</p>
            </div>
          )}

          {status === 'ready' && images.length === 0 && (
            <div className="empty">
              <span className="empty__badge">
                <Icon name="image" size={24} />
              </span>
              <h2 className="empty__title">{t(lang, 'noImages')}</h2>
              <p className="empty__desc">{t(lang, 'emptyDesc')}</p>
              <div className="empty__actions">
                <button className="btn btn--primary btn--lg" onClick={importFolder}>
                  <Icon name="folderPlus" size={16} />
                  {t(lang, 'importFolder')}
                </button>
              </div>
            </div>
          )}

          {barsVisible && hasSubfolders && !warningDismissed && (
            <div className="banner banner--warn" role="status">
              <Icon name="alert" size={15} />
              <span className="banner__text">{t(lang, 'subfolderWarning')}</span>
              <button
                className="banner__close"
                title={t(lang, 'dismiss')}
                aria-label={t(lang, 'dismiss')}
                onClick={(e) => {
                  e.stopPropagation();
                  setWarningDismissed(true);
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          )}

          {barsVisible && error && (
            <div className="banner banner--error" role="alert">
              <Icon name="alert" size={15} />
              <span className="banner__text">{error}</span>
            </div>
          )}

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

          {status === 'ready' && images.length > 0 && mode !== 'scroll' && view.s === 1 && (
            <>
              <button
                className="pager pager--prev"
                disabled={!canPrev}
                title={t(lang, 'prevPage')}
                aria-label={t(lang, 'prevPage')}
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Icon name="chevronLeft" size={20} />
              </button>
              <button
                className="pager pager--next"
                disabled={!canNext}
                title={t(lang, 'nextPage')}
                aria-label={t(lang, 'nextPage')}
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Icon name="chevronRight" size={20} />
              </button>
            </>
          )}
        </main>
      </div>

      {barsVisible && (
        <footer className="statusbar">
          <div className="statusbar__left">
            {mode === 'scroll' && images.length > 0 && (
              <span className="progress" aria-hidden="true">
                <span className="progress__fill" style={{ width: `${scrollProgress}%` }} />
              </span>
            )}
            {images.length > 0 && (
              <span className="statusbar__page" title={mode === 'scroll' ? t(lang, 'progress') : undefined}>
                {pageInfo}
              </span>
            )}
          </div>

          <div className="statusbar__center">
            <span className="statusbar__name">{currentNames.filter(Boolean).join(' ｜ ')}</span>
          </div>

          <div className="statusbar__right">
            <button
              className="zoom-btn"
              title={t(lang, 'zoomOut')}
              aria-label={t(lang, 'zoomOut')}
              onClick={() => zoomBy(1 / 1.1)}
            >
              <Icon name="minus" size={14} />
            </button>
            <button
              className="zoom-value"
              title={t(lang, 'resetZoom')}
              onClick={resetZoom}
            >
              {Math.round(view.s * 100)}%
            </button>
            <button
              className="zoom-btn"
              title={t(lang, 'zoomIn')}
              aria-label={t(lang, 'zoomIn')}
              onClick={() => zoomBy(1.1)}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        </footer>
      )}

      {!barsVisible && (
        <>
          <button
            className="reveal reveal--top"
            onClick={() => {
              setBarsVisible(true);
              setDirVisible(true);
            }}
          >
            <Icon name="chevronDown" size={12} />
            <span>{t(lang, 'showBarsTop')}</span>
          </button>
          <button
            className="reveal reveal--bottom"
            onClick={() => {
              setBarsVisible(true);
              setDirVisible(true);
            }}
          >
            <span>{t(lang, 'showBarsBottom')}</span>
            <Icon name="chevronDown" size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
        </>
      )}

      {hintsOpen && (
        <div className="sheet-scrim" onClick={() => setHintsOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, 'shortcutsTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet__head">
              <h3 className="sheet__title">{t(lang, 'shortcutsTitle')}</h3>
              <button
                className="icon-btn"
                onClick={() => setHintsOpen(false)}
                aria-label={t(lang, 'close')}
                title={t(lang, 'close')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <ul className="sheet__rows">
              <li className="sheet__row">
                <span>{t(lang, 'scTurn')}</span>
                <span className="sheet__keys">
                  <kbd>←</kbd>
                  <kbd>→</kbd>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                  <kbd>PageUp</kbd>
                  <kbd>PageDown</kbd>
                  <span className="sheet__sep">/</span>
                  <span className="sheet__text">{t(lang, 'scWheel')}</span>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scZoom')}</span>
                <span className="sheet__keys">
                  <kbd>Ctrl</kbd>
                  <span className="sheet__sep">+</span>
                  <span className="sheet__text">{t(lang, 'scWheel')}</span>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scReset')}</span>
                <span className="sheet__keys">
                  <span className="sheet__text">{t(lang, 'scResetKeys')}</span>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scDir')}</span>
                <span className="sheet__keys">
                  <kbd>D</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scImmersive')}</span>
                <span className="sheet__keys">
                  <kbd>{hideKey}</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scHelp')}</span>
                <span className="sheet__keys">
                  <kbd>?</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scCloseSheet')}</span>
                <span className="sheet__keys">
                  <kbd>Esc</kbd>
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
