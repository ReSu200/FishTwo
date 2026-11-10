import { memo } from 'react';
import type { ImageEntry } from '@/utils/files';
import ImageItem from './ImageItem';

interface ScrollListProps {
  images: ImageEntry[];
  zoom: number;
  /** 当前会话旋转角度（0 表示不旋转） */
  rotation: number;
  /** 需要旋转的图片索引（-1 表示无） */
  rotateIndex: number;
  /** 旋转前图片显示宽高 */
  rotateW: number;
  rotateH: number;
  /** 旋转后包围盒宽高（用于撑出滚动布局高度） */
  rotateBoxW: number;
  rotateBoxH: number;
  onSize?: (name: string, width: number, height: number) => void;
}

/**
 * 下拉滚动模式的图片列表。
 * 说明：滚动时父组件会因 currentIndex / 进度变化而重渲染，这里单独 memo 隔离，
 * 只在 images / zoom / 旋转相关 props 变化时才重新渲染，避免每次滚动重建数百个条目。
 */
function ScrollList({
  images,
  zoom,
  rotation,
  rotateIndex,
  rotateW,
  rotateH,
  rotateBoxW,
  rotateBoxH,
  onSize,
}: ScrollListProps) {
  return (
    <div className="scroll">
      {images.map((img, index) => {
        const rotated = rotation !== 0 && index === rotateIndex && rotateW > 0 && rotateH > 0;
        return (
          <div key={img.name} id={`img-${index}`} data-index={index} className="scroll__item" style={{ zoom }}>
            {rotated ? (
              <div className="scroll-rot" style={{ width: rotateBoxW, height: rotateBoxH }}>
                <div
                  className="scroll-rot__inner"
                  style={{
                    width: rotateW,
                    height: rotateH,
                    transform: `rotate(${rotation}deg)`,
                  }}
                >
                  <ImageItem fileHandle={img.fileHandle} alt={img.name} lazy onSize={onSize} />
                </div>
              </div>
            ) : (
              <ImageItem fileHandle={img.fileHandle} alt={img.name} lazy onSize={onSize} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default memo(ScrollList);
