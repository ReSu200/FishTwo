import { memo, useEffect, useState } from 'react';
import { getCachedThumb, requestThumb } from '@/utils/thumbs';
import Icon from './Icon';

interface ThumbnailProps {
  /** 缓存键：文件夹名 + 文件名 */
  cacheKey: string;
  fileHandle: FileSystemFileHandle;
}

/** 目录栏缩略图：进入可视区（虚拟滚动实际渲染）后按需生成 */
function Thumbnail({ cacheKey, fileHandle }: ThumbnailProps) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedThumb(cacheKey);
    if (cached) {
      setUrl(cached);
      setFailed(false);
      return;
    }

    setUrl('');
    setFailed(false);
    let active = true;
    const { promise, cancel } = requestThumb(cacheKey, fileHandle);
    promise
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      cancel();
    };
  }, [cacheKey, fileHandle]);

  if (failed) {
    return (
      <span className="dirlist__thumb dirlist__thumb--error" aria-hidden="true">
        <Icon name="image" size={14} />
      </span>
    );
  }

  if (!url) {
    return <span className="dirlist__thumb dirlist__thumb--loading" aria-hidden="true" />;
  }

  return (
    <img
      className="dirlist__thumb"
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export default memo(Thumbnail);
