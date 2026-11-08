import { useEffect, useRef, useState } from 'react';

interface ImageItemProps {
  fileHandle: FileSystemFileHandle;
  alt: string;
  /** 懒加载：仅在进入视口附近时才读取文件并创建 object URL（用于下拉滚动） */
  lazy?: boolean;
}

/** 渲染单张图片：按需读取文件并创建 object URL，卸载时回收；支持视口懒加载 */
export default function ImageItem({ fileHandle, alt, lazy = false }: ImageItemProps) {
  const [url, setUrl] = useState('');
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let objectUrl = '';
    let active = true;

    const load = () => {
      fileHandle.getFile().then((file) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
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

  if (!url) {
    return <div ref={hostRef} className="image-item--loading" role="img" aria-label={alt} />;
  }

  return <img className="image-item" src={url} alt={alt} draggable={false} />;
}