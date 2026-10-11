/**
 * 极简线性图标集。
 * 全部为 16×16 stroke 路径，风格统一，不引入图标库依赖。
 */

export type IconName =
  | 'play'
  | 'stop'
  | 'check'
  | 'x'
  | 'warn'
  | 'info'
  | 'terminal'
  | 'file'
  | 'diff'
  | 'branch'
  | 'chevronRight'
  | 'chevronDown'
  | 'copy'
  | 'plus'
  | 'refresh'
  | 'question'
  | 'shield'
  | 'clock'
  | 'dot'
  | 'spinner'
  | 'folder'
  | 'user'
  | 'cpu'
  | 'arrowRight'
  | 'layers'
  | 'sparkle'
  | 'lock';

const PATHS: Record<IconName, string> = {
  play: 'M4.5 2.8v10.4L13.5 8z',
  stop: 'M4.2 4.2h7.6v7.6H4.2z',
  check: 'M3.2 8.4l3.4 3.4L12.8 4.6',
  x: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
  warn: 'M8 2.3l6.3 11H1.7zM8 6.6v3.1M8 11.4v1',
  info: 'M8 1.9a6.1 6.1 0 100 12.2A6.1 6.1 0 008 1.9zM8 7.3v4M8 4.7v1',
  terminal: 'M2.6 2.8h10.8v10.4H2.6zM5.4 6.2l1.8 1.8-1.8 1.8M8.9 10.2h2.6',
  file: 'M9.2 2H4.6A1.4 1.4 0 003.2 3.4v9.2A1.4 1.4 0 004.6 14h6.8a1.4 1.4 0 001.4-1.4V5.6zM9.2 2v3.6h3.6',
  diff: 'M3.9 3.2v9.6M12.1 3.2v9.6M6.3 6.3h3.6M6.3 9.9h3.6',
  branch: 'M4.6 5.2a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4.6 13.8a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM11.4 9.4a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4.6 5.2v5.6M6.1 6.4h3.8a1.5 1.5 0 011.5 1.5v0',
  chevronRight: 'M6.2 3.4l4.6 4.6-4.6 4.6',
  chevronDown: 'M3.4 6.2l4.6 4.6 4.6-4.6',
  copy: 'M5.6 5.6h7v7h-7zM3.4 3.4h7v2.2M3.4 3.4v7h2.2',
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  refresh: 'M13.1 8A5.1 5.1 0 113.4 5.3M13.1 2.4v3.2h-3.2',
  question:
    'M8 1.9a6.1 6.1 0 100 12.2A6.1 6.1 0 008 1.9zM6.1 6.2a1.9 1.9 0 013.7.5c0 1.2-1.8 1.4-1.8 2.7M8 11.5v1',
  shield: 'M8 1.9l5 1.9v4.1c0 3-2.1 5.3-5 6.2-2.9-.9-5-3.2-5-6.2V3.8z',
  clock: 'M8 1.9a6.1 6.1 0 100 12.2A6.1 6.1 0 008 1.9zM8 4.7V8l2.5 1.7',
  dot: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  spinner: 'M8 1.9a6.1 6.1 0 016.1 6.1',
  folder: 'M2.2 4.1h4l1.5 1.7h6.1v6.9a1.4 1.4 0 01-1.4 1.4H3.6a1.4 1.4 0 01-1.4-1.4z',
  user: 'M8 8.1a2.85 2.85 0 100-5.7 2.85 2.85 0 000 5.7zM3.1 13.9c0-2.5 2.2-4.3 4.9-4.3s4.9 1.8 4.9 4.3',
  cpu: 'M5.2 5.2h5.6v5.6H5.2zM3.2 3.2h9.6v9.6H3.2zM6.2 1.6v1.6M9.8 1.6v1.6M6.2 12.8v1.6M9.8 12.8v1.6M1.6 6.2h1.6M1.6 9.8h1.6M12.8 6.2h1.6M12.8 9.8h1.6',
  arrowRight: 'M3.2 8h9.2M8.9 4.5L12.4 8l-3.5 3.5',
  layers: 'M8 2.1l5.5 2.9L8 7.9 2.5 5zM2.5 8.4L8 11.3l5.5-2.9M2.5 11.4L8 14.3l5.5-2.9',
  sparkle: 'M8 1.9l1.5 4.6L14.1 8l-4.6 1.5L8 14.1l-1.5-4.6L1.9 8l4.6-1.5z',
  lock: 'M4.3 7.2h7.4v6.1H4.3zM6 7.2V5.4a2 2 0 014 0v1.8M8 9.6v1.6',
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** 仅在有语义时提供；纯装饰图标不要给 title */
  title?: string;
  filled?: boolean;
}

export function Icon({ name, size = 14, className, title, filled }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
