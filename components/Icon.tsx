import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'folder'
  | 'folderPlus'
  | 'moon'
  | 'sun'
  | 'eyeOff'
  | 'help'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'minus'
  | 'plus'
  | 'search'
  | 'close'
  | 'modeScroll'
  | 'modeSingle'
  | 'modeDouble'
  | 'sidebar'
  | 'reset'
  | 'arrowRight'
  | 'alert'
  | 'image';

const content: Record<IconName, ReactNode> = {
  folder: (
    <path d="M3.6 8.2A2.2 2.2 0 0 1 5.8 6h3.5l2 2h6.9a2.2 2.2 0 0 1 2.2 2.2v7.6A2.2 2.2 0 0 1 18.2 20H5.8a2.2 2.2 0 0 1-2.2-2.2z" />
  ),
  folderPlus: (
    <>
      <path d="M3.6 8.2A2.2 2.2 0 0 1 5.8 6h3.5l2 2h6.9a2.2 2.2 0 0 1 2.2 2.2v7.6A2.2 2.2 0 0 1 18.2 20H5.8a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M12 11.5v5M9.5 14h5" />
    </>
  ),
  moon: <path d="M20.5 13.4A8.6 8.6 0 0 1 10.6 3.5 8.6 8.6 0 1 0 20.5 13.4z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.7 6.2A9.9 9.9 0 0 1 12 6c5 0 9 4.4 9 6 0 .7-.6 1.8-1.6 3M6.4 7.9C4.5 9.3 3 11.2 3 12c0 1.6 4 6 9 6 1.3 0 2.5-.3 3.6-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.7 9.4a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.7" />
      <path d="M12 16.9h.01" />
    </>
  ),
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  modeScroll: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  modeSingle: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.4" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  modeDouble: (
    <>
      <rect x="3" y="5" width="7.6" height="14" rx="1.6" />
      <rect x="13.4" y="5" width="7.6" height="14" rx="1.6" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6" />
      <path d="M9.4 4.4v15.2" />
    </>
  ),
  reset: <path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1M3.6 4.2v5h5" />,
  arrowRight: <path d="M4.6 12h14.8M13.6 6l6 6-6 6" />,
  alert: (
    <>
      <path d="M10.3 4.4 2.6 17.6a1.8 1.8 0 0 0 1.6 2.7h15.6a1.8 1.8 0 0 0 1.6-2.7L13.7 4.4a1.9 1.9 0 0 0-3.4 0z" />
      <path d="M12 9.6v4M12 16.9h.01" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4" />
      <circle cx="8.8" cy="9.4" r="1.5" />
      <path d="M4 16.2l4.4-4.2 3.2 3.1 2.9-2.7L20 16.4" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

/** 统一的线性图标（currentColor 描边，随主题变色） */
export default function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {content[name]}
    </svg>
  );
}
