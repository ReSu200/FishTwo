import { memo } from 'react';
import type { ImageEntry } from '@/utils/files';
import ImageItem from './ImageItem';

interface ScrollListProps {
  images: ImageEntry[];
  zoom: number;
}

/**
 * 下拉滚动模式的图片列表。
 * 说明：滚动时父组件会因 currentIndex / 进度变化而重渲染，这里单独 memo 隔离，
 * 只在 images 或 zoom 变化时才重新渲染，避免每次滚动重建数百个条目。
 */
function ScrollList({ images, zoom }: ScrollListProps) {
  return (
    <div className="scroll">
      {images.map((img, index) => (
        <div
          key={img.name}
          id={`img-${index}`}
          data-index={index}
          className="scroll__item"
          style={{ zoom }}
        >
          <ImageItem fileHandle={img.fileHandle} alt={img.name} lazy />
        </div>
      ))}
    </div>
  );
}

export default memo(ScrollList);
