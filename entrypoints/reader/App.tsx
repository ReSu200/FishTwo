import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanTopLevelImages, type ImageEntry, type ScanResult } from '@/utils/files';
import { saveLastDir, loadLastDir } from '@/utils/db';
import { doubleSpreadCount, spreadOfIndex, doubleIndices } from '@/utils/paging';
import ImageItem from '@/components/ImageItem';
import ScrollList from '@/components/ScrollList';
import Thumbnail from '@/components/Thumbnail';
import Icon, { type IconName } from '@/components/Icon';
import Logo from '@/components/Logo';
import {
  DEFAULT_CONFIG,
  clampZoom,
  loadConfig,
  loadFolderState,
  loadLastZoom,
  normalizeShortcuts,
  saveConfig,
  saveFolderState,
  saveLastZoom,
  type FolderState,
  type ReaderConfig,
  type ReaderMode,
} from '@/utils/config';
import { extractDirectoryHandle, supportsDirectoryDrop } from '@/utils/drop';
import { clearThumbs, thumbKey } from '@/utils/thumbs';
import { resolveLang, t, type Lang } from '@/utils/i18n';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const MODES: { key: ReaderMode; labelKey: string; icon: IconName }[] = [
  { key: 'scroll', labelKey: 'modeScroll', icon: 'modeScroll' },
  { key: 'single', labelKey: 'modeSingle', icon: 'modeSingle' },
  { key: 'double', labelKey: 'modeDouble', icon: 'modeDouble' },
];

// 目录栏虚拟滚动参数（与 CSS .dirlist__item 的 height 保持一致）
const DIR_ROW_H = 48;
const DIR_OVERSCAN = 6;

/** 空状态插画：静态内容，提到模块级避免每次渲染重建 */
const EMPTY_ART = (
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
);

interface View {
  s: number;
  x: number;
  y: number;
}

interface NaturalSize {
  w: number;
  h: number;
}

interface Size2D {
  w: number;
  h: number;
}

/**
 * 计算旋转后不越界的「未旋转显示尺寸」。
 * boxH 为 null 表示仅约束宽度（下拉滚动，高度可滚动）。
 */
function fitRotatedSize(
  natural: NaturalSize,
  boxW: number,
  boxH: number | null,
  rotation: number,
): Size2D | null {
  if (!natural || natural.w <= 0 || natural.h <= 0 || boxW <= 0) return null;
  const ratio = natural.w / natural.h;
  const rot = ((rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  if (boxH === null) {
    const w = swapped
      ? ratio <= 1
        ? Math.min(natural.w, boxW * ratio)
        : Math.min(natural.w, boxW)
      : Math.min(natural.w, boxW);
    return { w, h: w / ratio };
  }
  const w = swapped
    ? Math.min(natural.w, boxH, boxW * ratio)
    : Math.min(natural.w, boxW, boxH * ratio);
  return { w, h: w / ratio };
}

/** 旋转 90°/270° 时，包围盒宽高互换 */
function rotatedBox(fit: Size2D, rotation: number): Size2D {
  const rot = ((rotation % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { w: fit.h, h: fit.w } : { w: fit.w, h: fit.h };
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
  // 当前会话的图片旋转角度（0 / 90 / 180 / 270），翻页或切换文件夹后复位
  const [rotation, setRotation] = useState(0);
  // 图片自然尺寸（按文件名），用于旋转后的尺寸适配
  const [naturalSizes, setNaturalSizes] = useState<Record<string, NaturalSize>>({});
  // 舞台内容区尺寸（不含 padding），用于旋转尺寸计算
  const [stageSize, setStageSize] = useState<Size2D>({ w: 0, h: 0 });
  // 拖入文件夹时的覆盖层
  const [dragActive, setDragActive] = useState(false);
  // 每次导入目录递增，用于强制重建目录项与缩略图（同一文件夹重新授权时也能刷新）
  const [folderSession, setFolderSession] = useState(0);

  // 已存句柄但权限待确认时，展示「重新授权」
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [reauthNeeded, setReauthNeeded] = useState(false);

  const stageRef = useRef<HTMLElement | null>(null);
  const lastFlipRef = useRef(0);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // 目录栏虚拟滚动
  const listRef = useRef<HTMLUListElement | null>(null);
  const [listView, setListView] = useState({ top: 0, height: 0 });
  // 最新值引用：让事件订阅（键盘等）不因这些值变化而反复重订阅
  const viewRef = useRef(view);
  const barsVisibleRef = useRef(barsVisible);
  const hintsOpenRef = useRef(hintsOpen);
  const shortcutsRef = useRef(config.shortcuts);
  const configRef = useRef(config);
  const lastZoomRef = useRef<number | undefined>(undefined);
  // 目录跳转的校正序号：用户主动滚动/按键时递增，使未执行的校正失效
  const jumpSeqRef = useRef(0);
  // 目录加载序号：快速连续导入时，旧目录的延迟回调不再生效
  const loadSeqRef = useRef(0);
  // 存储写入防抖：滚动/缩放/翻页会高频变化，攒一段时间再写，避免每次变化都写 storage
  const pendingStateRef = useRef<{ dir: string; state: FolderState } | null>(null);
  const pendingZoomRef = useRef<number | null>(null);
  // 拖入覆盖层的进入计数，避免子元素触发 dragleave 时闪烁
  const dragDepthRef = useRef(0);

  const spreadCount = doubleSpreadCount(images.length);
  const currentSpread = spreadOfIndex(currentIndex);
  const shortcuts = config.shortcuts;
  const immersiveKey = (shortcuts.immersive || 'f').toUpperCase();

  // 把最新的 view / 状态栏可见性 / 快捷键同步到 ref，供事件处理器读取
  useEffect(() => {
    viewRef.current = view;
    barsVisibleRef.current = barsVisible;
    hintsOpenRef.current = hintsOpen;
    shortcutsRef.current = config.shortcuts;
    configRef.current = config;
  });

  /** 按当前缩放重新居中（在事件处理器中计算，保持 setView 为纯更新） */
  const recenter = useCallback(() => {
    const s = viewRef.current.s;
    setView({ s, ...centeredOffset(stageRef.current, s) });
  }, []);

  /** 立即落盘尚未写入的文件夹状态（切换文件夹 / 卸载前调用） */
  const flushPendingState = useCallback(() => {
    const pending = pendingStateRef.current;
    if (!pending) return;
    pendingStateRef.current = null;
    void saveFolderState(pending.dir, pending.state);
  }, []);

  /** 图片加载后上报自然尺寸，供旋转尺寸计算 */
  const onImageSize = useCallback((name: string, w: number, h: number) => {
    if (!name || w <= 0 || h <= 0) return;
    setNaturalSizes((prev) => {
      const current = prev[name];
      if (current && current.w === w && current.h === h) return prev;
      return { ...prev, [name]: { w, h } };
    });
  }, []);

  const rotateBy = useCallback((delta: number) => {
    setRotation((r) => (((r + delta) % 360) + 360) % 360);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        /* 浏览器拒绝时静默失败 */
      });
      return;
    }
    void document.documentElement.requestFullscreen().catch(() => {
      /* 无用户手势或被拒绝时静默失败 */
    });
  }, []);

  const goPrev = useCallback(() => {
    setRotation(0);
    if (mode === 'single') {
      setCurrentIndex((i) => Math.max(i - 1, 0));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const prevSpread = Math.max(spreadOfIndex(i) - 1, 0);
        return doubleIndices(prevSpread, images.length)[0] ?? 0;
      });
    }
    recenter();
  }, [mode, images.length, recenter]);

  const goNext = useCallback(() => {
    setRotation(0);
    if (mode === 'single') {
      setCurrentIndex((i) => Math.min(i + 1, images.length - 1));
    } else if (mode === 'double') {
      setCurrentIndex((i) => {
        const nextSpread = Math.min(spreadOfIndex(i) + 1, doubleSpreadCount(images.length) - 1);
        return doubleIndices(nextSpread, images.length)[0] ?? i;
      });
    }
    recenter();
  }, [mode, images.length, recenter]);

  // 初始化配置 + 自动恢复最近文件夹
  useEffect(() => {
    void init();
  }, []);

  async function init() {
    // 配置、缩放记忆、最近目录彼此独立，并行读取减少启动串行等待
    const [cfg, z, handle] = await Promise.all([
      loadConfig(),
      loadLastZoom(),
      loadLastDir(),
    ]);
    configRef.current = cfg;
    lastZoomRef.current = z;
    document.documentElement.dataset.theme = cfg.theme;
    setConfig(cfg);
    setLang(resolveLang(cfg.lang));
    setMode(cfg.defaultMode);
    if (cfg.zoomDefault === 'memory' && z !== undefined) {
      setView((v) => ({ ...v, s: clampZoom(z) }));
    }
    if (handle) await restoreDir(handle);
  }

  // 记忆上次缩放（防抖写入：连续 Ctrl+滚轮只写最后一次）
  useEffect(() => {
    if (config.zoomDefault !== 'memory') return;
    lastZoomRef.current = view.s;
    pendingZoomRef.current = view.s;
    const id = window.setTimeout(() => {
      if (pendingZoomRef.current !== null) void saveLastZoom(pendingZoomRef.current);
    }, 400);
    return () => window.clearTimeout(id);
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
      const safe: ReaderConfig = {
        ...next,
        shortcuts: normalizeShortcuts(next.shortcuts, next.hideKey),
      };
      document.documentElement.dataset.theme = safe.theme;
      configRef.current = safe;
      shortcutsRef.current = safe.shortcuts;
      setConfig(safe);
      setLang(resolveLang(safe.lang));
    }
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, []);

  // 标签页标题随语言切换
  useEffect(() => {
    document.title = `${t(lang, 'name')} · ${t(lang, 'reader')}`;
  }, [lang]);

  // 翻页、切换模式或文件夹后，旋转回到原始方向
  useEffect(() => {
    setRotation(0);
  }, [currentIndex, mode, dirName]);

  // 测量舞台内容区尺寸，供旋转后的尺寸适配
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const cs = getComputedStyle(el);
      // clientWidth / clientHeight 不含滚动条，再减去 padding，得到真正的内容区尺寸
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const h = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      setStageSize((prev) =>
        Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h },
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode, dirVisible]);

  // 阻止把文件拖到舞台外时浏览器直接打开文件；拖拽结束时兜底关闭覆盖层
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const reset = () => {
      dragDepthRef.current = 0;
      setDragActive(false);
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  // 键盘：翻页 + 目录/沉浸/全屏 + 旋转 + 快捷键面板
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (hintsOpenRef.current) {
          e.preventDefault();
          setHintsOpen(false);
        }
        return;
      }
      // 搜索框等输入场景不拦截按键
      if (isTypingTarget(e.target)) return;
      // 带 Ctrl / Alt / Meta 的组合键交还给浏览器（如 Ctrl+F 查找）
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setHintsOpen((v) => !v);
        return;
      }
      // 快捷键面板打开时，除 Esc / ? 外不响应其它按键
      if (hintsOpenRef.current) return;

      const key = e.key.toLowerCase();
      if (key === shortcutsRef.current.immersive) {
        // 沉浸模式：隐藏状态栏时一并隐藏目录，显示时一并恢复
        const next = !barsVisibleRef.current;
        setBarsVisible(next);
        setDirVisible(next);
        return;
      }
      if (key === shortcutsRef.current.dir) {
        setDirVisible((v) => !v);
        return;
      }
      if (key === shortcutsRef.current.fullscreen) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      // 旋转为固定键位：Q 逆时针 / E 顺时针
      if (key === 'q') {
        rotateBy(-90);
        return;
      }
      if (key === 'e') {
        rotateBy(90);
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
  }, [mode, goPrev, goNext, rotateBy, toggleFullscreen]);

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

  // 下拉滚动模式：一次滚动同时更新「当前图片索引」与「阅读进度」。
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
      if (items.length > 0) {
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
      }
      const max = root.scrollHeight - root.clientHeight;
      const p = max > 0 ? Math.round((root.scrollTop / max) * 100) : 100;
      setScrollProgress(Math.max(0, Math.min(100, p)));
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

  // 记忆文件夹阅读状态（位置 + 模式 + 缩放）：防抖写入，切换文件夹/卸载前补写
  useEffect(() => {
    if (!dirName || status !== 'ready') return;
    pendingStateRef.current = { dir: dirName, state: { index: currentIndex, mode, zoom: view.s } };
    const id = window.setTimeout(() => flushPendingState(), 400);
    return () => window.clearTimeout(id);
  }, [currentIndex, mode, view.s, dirName, status, flushPendingState]);

  // 卸载前把尚未落盘的缩放/文件夹状态补写一次，并回收缩略图缓存
  useEffect(
    () => () => {
      flushPendingState();
      if (pendingZoomRef.current !== null) void saveLastZoom(pendingZoomRef.current);
      clearThumbs();
    },
    [flushPendingState],
  );

  // 目录栏虚拟滚动：测量可视区域并随滚动/尺寸变化更新窗口
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let raf = 0;
    // 用 rAF 延后到布局稳定后再测量，避免读到未约束的高度导致一次性渲染全部条目
    const measure = () => {
      raf = 0;
      const height = el.clientHeight;
      const top = el.scrollTop;
      setListView((prev) => (prev.height === height && prev.top === top ? prev : { top, height }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [status, images, dirVisible]);

  async function restoreDir(handle: FileSystemDirectoryHandle) {
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      await loadFromHandle(handle);
    } else if (perm === 'prompt') {
      setStoredHandle(handle);
      setReauthNeeded(true);
    }
  }

  async function loadFromHandle(handle: FileSystemDirectoryHandle, pre?: ScanResult) {
    // 切换目录前先把上一个文件夹的阅读状态落盘
    flushPendingState();
    const seq = ++loadSeqRef.current;
    setStatus('loading');
    setError('');
    setWarningDismissed(false);
    setDirQuery('');
    try {
      // 目录扫描与该文件夹的阅读状态互不依赖，并行读取
      const [result, state] = await Promise.all([
        pre ? Promise.resolve(pre) : scanTopLevelImages(handle),
        loadFolderState(handle.name),
      ]);
      // 快速连续导入时，旧目录的结果直接丢弃
      if (loadSeqRef.current !== seq) return;
      const cfg = configRef.current;
      const nextMode = state?.mode ?? cfg.defaultMode;
      const rememberedZoom = lastZoomRef.current;
      const fallbackZoom =
        cfg.zoomDefault === 'memory' && rememberedZoom !== undefined ? clampZoom(rememberedZoom) : 1;
      const nextZoom = state?.zoom !== undefined ? clampZoom(state.zoom) : fallbackZoom;
      const startIndex =
        typeof state?.index === 'number' && state.index >= 0 && state.index < result.images.length
          ? Math.floor(state.index)
          : 0;

      clearThumbs();
      setFolderSession((n) => n + 1);
      setImages(result.images);
      setHasSubfolders(result.hasSubfolders);
      setDirName(handle.name);
      setMode(nextMode);
      setView({ s: nextZoom, x: 0, y: 0 });
      setNaturalSizes({});
      setRotation(0);
      setCurrentIndex(startIndex);
      setStatus('ready');

      if (nextMode === 'scroll') {
        if (startIndex > 0) {
          // 图片为懒加载，先滚动一次后等其高度确定再校正一次，避免落点偏移
          window.setTimeout(() => {
            if (loadSeqRef.current === seq) scrollToImage(startIndex, 'auto');
          }, 120);
        }
      } else if (nextZoom !== 1) {
        // 单/双页恢复缩放后，在布局稳定后按舞台中心重新居中
        window.setTimeout(() => {
          if (loadSeqRef.current !== seq) return;
          setView({ s: nextZoom, ...centeredOffset(stageRef.current, nextZoom) });
        }, 60);
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

  function onDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave() {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  async function onDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);

    if (!supportsDirectoryDrop()) {
      setError(t(lang, 'dropUnsupported'));
      return;
    }
    const handle = await extractDirectoryHandle(e.dataTransfer.items);
    if (!handle) {
      setError(t(lang, 'dropNotFolder'));
      return;
    }
    try {
      // 先校验目录内是否有图片，避免空目录替换当前阅读状态
      const result = await scanTopLevelImages(handle);
      if (result.images.length === 0) {
        setError(t(lang, 'dropNoImages'));
        return;
      }
      await saveLastDir(handle);
      setStoredHandle(null);
      setReauthNeeded(false);
      await loadFromHandle(handle, result);
    } catch (err) {
      setError(String(err));
    }
  }

  function selectMode(next: ReaderMode) {
    setMode(next);
    setRotation(0);
    setCurrentIndex((i) => Math.min(i, Math.max(images.length - 1, 0)));
    recenter();
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

  /**
   * 滚动定位到指定图片。
   * 说明：图片懒加载会把占位块（约 220px）换成真实高度，跳转途中上方内容持续变高会把目标推走，
   * 固定次数的定时校正无法收敛（大目录下会明显偏前），故改为「校正到目标位置稳定」的收敛式滚动。
   * 用户滚轮操作会递增 jumpSeq 从而中断校正。
   */
  function scrollToImage(index: number, behavior: ScrollBehavior = 'smooth') {
    const seq = ++jumpSeqRef.current;
    document.getElementById(`img-${index}`)?.scrollIntoView({ behavior, block: 'start' });

    const stage = stageRef.current;
    if (!stage) return;
    // 样式只读一次，避免在 60ms × 最长 3s 的校正循环里反复触发样式计算
    const paddingTop = parseFloat(getComputedStyle(stage).paddingTop) || 0;
    const deadline = Date.now() + 3000;
    let lastOffset = Number.NaN;
    let stable = 0;

    const step = () => {
      if (jumpSeqRef.current !== seq) return;
      const el = document.getElementById(`img-${index}`);
      if (!el) return;
      const contentTop = stage.getBoundingClientRect().top + paddingTop;
      const delta = el.getBoundingClientRect().top - contentTop;
      // 目标当前在内容中的位置（用于判断是否已稳定）
      const offset = Math.round(stage.scrollTop + delta);
      if (Math.abs(delta) > 1.5) stage.scrollTop += delta;
      // 目标图片尚未解码完成时不计入稳定：加载后高度变化会把落点推走
      const img = el.querySelector<HTMLImageElement>('img.image-item');
      const loading = !!el.querySelector('.image-item--loading');
      const failed = !!el.querySelector('.image-item--error');
      const waiting = loading || (img ? !img.complete : !failed);
      if (!waiting && Math.abs(delta) <= 1.5 && offset === lastOffset) stable += 1;
      else stable = 0;
      lastOffset = offset;
      if (stable >= 2 || Date.now() > deadline) return;
      window.setTimeout(step, waiting ? 80 : 60);
    };
    window.setTimeout(step, 60);
  }

  function jumpTo(index: number) {
    setRotation(0);
    setCurrentIndex(index);
    if (mode === 'scroll') {
      scrollToImage(index);
    }
  }

  // 目录过滤：同时产出「图片索引 → 过滤后位置」映射，避免每次滚动做 O(n) 查找
  const { filtered, posByIndex } = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    const list: { img: ImageEntry; index: number }[] = [];
    const pos = new Map<number, number>();
    images.forEach((img, index) => {
      if (!q || img.name.toLowerCase().includes(q)) {
        pos.set(index, list.length);
        list.push({ img, index });
      }
    });
    return { filtered: list, posByIndex: pos };
  }, [images, dirQuery]);

  // 目录栏虚拟滚动窗口：仅渲染可视区域附近的条目
  const dirTotal = filtered.length;
  const dirStart = Math.max(0, Math.floor(listView.top / DIR_ROW_H) - DIR_OVERSCAN);
  const dirEnd = Math.min(
    dirTotal,
    dirStart + Math.ceil((listView.height || 400) / DIR_ROW_H) + DIR_OVERSCAN * 2,
  );
  const dirSlice = filtered.slice(dirStart, dirEnd);

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

  // 旋转尺寸适配：单页 / 滚动用当前图片，双页按半宽分别计算
  const currentName = images[currentIndex]?.name ?? '';
  const currentNatural = currentName ? naturalSizes[currentName] : undefined;
  const singleFit =
    rotation && currentNatural
      ? fitRotatedSize(currentNatural, stageSize.w, stageSize.h, rotation)
      : null;
  const scrollFit =
    rotation && currentNatural ? fitRotatedSize(currentNatural, stageSize.w, null, rotation) : null;
  const scrollBox = scrollFit ? rotatedBox(scrollFit, rotation) : null;
  const doubleBoxW = Math.max(0, (stageSize.w - 16) / 2);
  const doublePages =
    mode === 'double'
      ? doubleIndices(currentSpread, images.length).map((i) => {
          const name = images[i]?.name ?? '';
          const natural = name ? naturalSizes[name] : undefined;
          const fit =
            rotation && natural ? fitRotatedSize(natural, doubleBoxW, stageSize.h, rotation) : null;
          return { index: i, name, fit };
        })
      : [];

  // 目录栏：当前项保持在可视区域内（虚拟滚动下按行高计算并滚动容器）
  useEffect(() => {
    const el = listRef.current;
    if (!el || !dirVisible) return;
    let pos = -1;
    for (const idx of activeIndices) {
      const p = posByIndex.get(idx);
      if (p !== undefined && (pos < 0 || p < pos)) pos = p;
    }
    if (pos < 0) return;
    const top = pos * DIR_ROW_H;
    const bottom = top + DIR_ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [currentIndex, currentSpread, mode, dirQuery, dirVisible, posByIndex]);

  return (
    <div
      className="reader"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
            <div className="segmented" role="group" aria-label={t(lang, 'readingMode')}>
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
              title={t(lang, 'rotateLeft')}
              aria-label={t(lang, 'rotateLeft')}
              disabled={images.length === 0}
              onClick={() => rotateBy(-90)}
            >
              <Icon name="rotateLeft" size={17} />
            </button>
            <button
              className="icon-btn"
              title={t(lang, 'rotateRight')}
              aria-label={t(lang, 'rotateRight')}
              disabled={images.length === 0}
              onClick={() => rotateBy(90)}
            >
              <Icon name="rotateRight" size={17} />
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
              title={`${t(lang, 'hide')} (${immersiveKey})`}
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

          <ul className="dirlist__items" ref={listRef}>
            {/* 虚拟滚动占位：用内部占位元素而非容器 padding —— padding 不可收缩，会撑大滚动容器导致测量震荡 */}
            <li className="dirlist__spacer" aria-hidden="true" style={{ height: dirStart * DIR_ROW_H }} />
            {dirSlice.map(({ img, index }) => {
              const active = activeIndices.has(index);
              return (
                <li key={`${folderSession}:${img.name}`}>
                  <button
                    className={`dirlist__item${active ? ' dirlist__item--active' : ''}`}
                    title={img.name}
                    onClick={() => jumpTo(index)}
                  >
                    <span className="dirlist__no">{String(index + 1).padStart(2, '0')}</span>
                    <Thumbnail
                      cacheKey={thumbKey(dirName, img.name)}
                      fileHandle={img.fileHandle}
                    />
                    <span className="dirlist__name">{img.name}</span>
                  </button>
                </li>
              );
            })}
            <li className="dirlist__spacer" aria-hidden="true" style={{ height: (dirTotal - dirEnd) * DIR_ROW_H }} />
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
              {EMPTY_ART}
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
            <ScrollList
              images={images}
              zoom={view.s}
              rotation={rotation}
              rotateIndex={rotation ? currentIndex : -1}
              rotateW={scrollFit?.w ?? 0}
              rotateH={scrollFit?.h ?? 0}
              rotateBoxW={scrollBox?.w ?? 0}
              rotateBoxH={scrollBox?.h ?? 0}
              onSize={onImageSize}
            />
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
                <div
                  className={`rotator${singleFit ? ' rotator--active' : ''}`}
                  style={
                    singleFit
                      ? {
                          width: rotatedBox(singleFit, rotation).w,
                          height: rotatedBox(singleFit, rotation).h,
                        }
                      : undefined
                  }
                >
                  <div
                    className="rotator__inner"
                    style={
                      singleFit
                        ? {
                            width: singleFit.w,
                            height: singleFit.h,
                            transform: `rotate(${rotation}deg)`,
                          }
                        : undefined
                    }
                  >
                    <ImageItem
                      fileHandle={images[currentIndex].fileHandle}
                      alt={images[currentIndex].name}
                      onSize={onImageSize}
                    />
                  </div>
                </div>
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
              {doublePages.map(({ index, name, fit }) => {
                const img = images[index];
                const box = fit ? rotatedBox(fit, rotation) : null;
                return (
                  <div key={`${index}-${name}`} className="double__page">
                    {img && (
                      <div
                        className={`rotator${box ? ' rotator--active' : ''}`}
                        style={box ? { width: box.w, height: box.h } : undefined}
                      >
                        <div
                          className="rotator__inner"
                          style={
                            fit
                              ? {
                                  width: fit.w,
                                  height: fit.h,
                                  transform: `rotate(${rotation}deg)`,
                                }
                              : undefined
                          }
                        >
                          <ImageItem
                            fileHandle={img.fileHandle}
                            alt={img.name}
                            onSize={onImageSize}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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

      {dragActive && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone__inner">
            <Icon name="folderPlus" size={26} />
            <span>{t(lang, 'dropHint')}</span>
          </div>
        </div>
      )}

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
                <span>{t(lang, 'scRotate')}</span>
                <span className="sheet__keys">
                  <kbd>Q</kbd>
                  <kbd>E</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scDir')}</span>
                <span className="sheet__keys">
                  <kbd>{shortcuts.dir.toUpperCase()}</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scImmersive')}</span>
                <span className="sheet__keys">
                  <kbd>{immersiveKey}</kbd>
                </span>
              </li>
              <li className="sheet__row">
                <span>{t(lang, 'scFullscreen')}</span>
                <span className="sheet__keys">
                  <kbd>{shortcuts.fullscreen.toUpperCase()}</kbd>
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
