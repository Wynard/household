// Icons from the approved prototype. All decorative (aria-hidden); buttons carry labels.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, sw: number, rest: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...rest,
});

export const IconJar = ({ size = 24, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M7 3h10v3H7z" />
    <path d="M6 6h12l-1 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z" />
    <path d="M9 13h6" />
  </svg>
);
export const IconBook = ({ size = 24, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M5 17a3 3 0 0 1 3-3h11" />
  </svg>
);
export const IconChecklist = ({ size = 24, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />
  </svg>
);
export const IconBag = ({ size = 24, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </svg>
);
export const IconChart = ({ size = 24, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M4 20h16" />
    <path d="M7 16v-5M12 16V6M17 16v-8" />
  </svg>
);
export const IconGear = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconChat = ({ size = 26, ...r }: P) => (
  <svg {...base(size, 1.9, r)}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" />
    <path d="M12 8.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
  </svg>
);
export const IconMinus = ({ size = 18, ...r }: P) => (
  <svg {...base(size, 2.4, r)}>
    <path d="M5 12h14" />
  </svg>
);
export const IconPlus = ({ size = 18, ...r }: P) => (
  <svg {...base(size, 2.4, r)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconClose = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconBack = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconNext = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const IconCheck = ({ size = 15, ...r }: P) => (
  <svg {...base(size, 3, r)}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
export const IconBang = ({ size = 15, ...r }: P) => (
  <svg {...base(size, 3, r)}>
    <path d="M12 6v8M12 18v.5" />
  </svg>
);
export const IconStar = ({ size = 24, filled = false, ...r }: P & { filled?: boolean }) => (
  <svg {...base(size, 1.8, r)} fill={filled ? 'var(--highlight)' : 'none'}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
export const IconLink = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);
export const IconPen = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13 7l4 4" />
  </svg>
);
export const IconFilter = ({ size = 18, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);
export const IconReceipt = ({ size = 18, ...r }: P) => (
  <svg {...base(size, 2, r)}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
export const IconTimer = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M10 2h4" />
  </svg>
);
export const IconCamera = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2, r)}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconMic = ({ size = 22, ...r }: P) => (
  <svg {...base(size, 2, r)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const IconSend = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2.4, r)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconGrip = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
  </svg>
);
export const IconWarn = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2.2, r)}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17v.5" />
  </svg>
);
export const IconSearch = ({ size = 20, ...r }: P) => (
  <svg {...base(size, 2, r)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);
