import { memo, useEffect, useRef, useState } from 'react';

interface ImageItemProps {
  fileHandle: FileSystemFileHandle;
  alt: string;
  /** 懒加载：仅在进入视口附近时才读取文件并创建 object URL（用于下拉滚动） */
  lazy?: boolean;
  /** 图片加载完成后上报自然尺寸（用于旋转后的尺寸适配） */
  onSize?: (name: string, width: number, height: number) => void;
}

/** 渲染单张图片：按需读取文件并创建 object URL，卸载时回收；支持视口懒加载 */
function ImageItem({ fileHandle, alt, lazy = false, onSize }: ImageItemProps) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let objectUrl = '';
    let active = true;

    const load = () => {
      fileHandle
        .getFile()
        .then((file) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(file);
          setUrl(objectUrl);
        })
        .catch(() => {
          // 文件被移动/删除或权限失效时降级为错误占位，避免 unhandled rejection
          if (active) setFailed(true);
        });
    };

    let observer: IntersectionObserver | undefined;
    const host = hostRef.current;

    if (lazy && host && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              observer?.disconnect();
              load();
            }
          }
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(host);
    } else {
      load();
    }

    return () => {
      active = false;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileHandle, lazy]);

  if (failed) {
    return <div className="image-item--error" role="img" aria-label={alt} title={alt} />;
  }

  if (!url) {
    return <div ref={hostRef} className="image-item--loading" role="img" aria-label={alt} />;
  }

  return (
    <img
      className="image-item"
      src={url}
      alt={alt}
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        onSize?.(alt, img.naturalWidth, img.naturalHeight);
      }}
    />
  );
}

export default memo(ImageItem);