interface LogoProps {
  size?: number;
}

/** 品牌标识：直接使用扩展图标（public/icons），与浏览器工具栏保持一致 */
export default function Logo({ size = 26 }: LogoProps) {
  return (
    <img
      className="logo"
      src="/icons/128.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
