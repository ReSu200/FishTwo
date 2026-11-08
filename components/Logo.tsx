interface LogoProps {
  size?: number;
}

/** 品牌标识：薄荷渐变底 + 深青鱼身，与扩展图标风格一致 */
export default function Logo({ size = 26 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fishtwo-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#46d3b3" />
          <stop offset="1" stopColor="#12a184" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#fishtwo-logo)" />
      <path
        d="M9.4 16.2c2.6 3.5 5.8 5.3 9.5 5.3 3.2 0 5.7-2.3 5.7-5.3s-2.5-5.3-5.7-5.3c-3.7 0-6.9 1.8-9.5 5.3z"
        fill="#043b32"
        opacity=".92"
      />
      <path d="M9.8 16.2 5.6 12.5v7.4z" fill="#043b32" opacity=".92" />
      <circle cx="21.1" cy="14.7" r="1.15" fill="#fff" />
    </svg>
  );
}
