// 目录栏缩略图：可视区按需生成、并发限流、内存 LRU 缓存

const THUMB_SIZE = 72;
const MAX_CACHE = 300;
const MAX_CONCURRENT = 4;

interface Waiter {
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
}

interface Job {
  key: string;
  handle: FileSystemFileHandle;
  waiters: Set<Waiter>;
  started: boolean;
}

const cache = new Map<string, string>();
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let active = 0;
// 切换文件夹时递增：旧任务完成后不再写入缓存
let epoch = 0;

export function thumbKey(dir: string, name: string): string {
  return `${dir}::${name}`;
}

/** 读取已缓存的缩略图 URL，并刷新 LRU 顺序 */
export function getCachedThumb(key: string): string | undefined {
  const url = cache.get(key);
  if (!url) return undefined;
  cache.delete(key);
  cache.set(key, url);
  return url;
}

function trimCache() {
  while (cache.size > MAX_CACHE) {
    const first = cache.keys().next();
    if (first.done) break;
    const key = first.value;
    const url = cache.get(key);
    cache.delete(key);
    if (url) URL.revokeObjectURL(url);
  }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    if (jobs.get(job.key) !== job || job.waiters.size === 0) {
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      continue;
    }
    job.started = true;
    active += 1;
    void runJob(job);
  }
}

async function runJob(job: Job) {
  const jobEpoch = epoch;
  try {
    const file = await job.handle.getFile();
    const url = await makeThumbUrl(file);
    if (jobEpoch !== epoch) {
      URL.revokeObjectURL(url);
      throw new Error('thumbnail cache cleared');
    }
    cache.set(job.key, url);
    trimCache();
    for (const waiter of job.waiters) waiter.resolve(url);
  } catch (error) {
    for (const waiter of job.waiters) waiter.reject(error);
  } finally {
    job.waiters.clear();
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    active -= 1;
    pump();
  }
}

async function makeThumbUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE)
        : Object.assign(document.createElement('canvas'), {
            width: THUMB_SIZE,
            height: THUMB_SIZE,
          });
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('canvas context unavailable');

    // cover：等比缩放后居中裁切为正方形缩略图
    const scale = Math.max(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height);
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.drawImage(bitmap, (THUMB_SIZE - drawW) / 2, (THUMB_SIZE - drawH) / 2, drawW, drawH);

    const blob = await encodeJpeg(canvas);
    if (!blob) throw new Error('thumbnail encode failed');
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

function encodeJpeg(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
}

/**
 * 请求缩略图。返回 promise 与 cancel：
 * - 组件卸载时调用 cancel，未开始的任务会从队列移除；
 * - 已开始的任务完成后仍写入缓存，供下次滚动复用。
 */
export function requestThumb(
  key: string,
  handle: FileSystemFileHandle,
): { promise: Promise<string>; cancel: () => void } {
  const cached = getCachedThumb(key);
  if (cached) return { promise: Promise.resolve(cached), cancel: () => {} };

  let job = jobs.get(key);
  if (!job) {
    job = { key, handle, waiters: new Set(), started: false };
    jobs.set(key, job);
    queue.push(job);
  }

  let waiter!: Waiter;
  const target = job;
  const promise = new Promise<string>((resolve, reject) => {
    waiter = { resolve, reject };
    target.waiters.add(waiter);
  });

  // 注意：必须在加入 waiter 之后再 pump，否则队列会因 waiters 为空而立即丢弃任务
  pump();

  return {
    promise,
    cancel: () => {
      target.waiters.delete(waiter);
      if (!target.started && target.waiters.size === 0) {
        const index = queue.indexOf(target);
        if (index >= 0) queue.splice(index, 1);
        if (jobs.get(target.key) === target) jobs.delete(target.key);
      }
    },
  };
}

/** 切换文件夹 / 卸载时清空缓存并回收 object URL */
export function clearThumbs() {
  epoch += 1;
  cache.forEach((url) => URL.revokeObjectURL(url));
  cache.clear();
  queue.length = 0;
  for (const job of jobs.values()) {
    for (const waiter of job.waiters) waiter.reject(new Error('thumbnail cache cleared'));
    job.waiters.clear();
  }
  jobs.clear();
}
