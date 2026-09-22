import type { SVGProps } from "react";

/**
 * Ícones da casa, desenhados para o tema (grade 24, traço 1,75 — o mesmo do lucide no app). Os genéricos (+, ×, busca…) vêm do lucide.
 */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function Candle(props: P) {
  return (
    <Svg {...props}>
      <path className="origin-[12px_8px] motion-safe:animate-candle" d="M12 2.6c1.6 1.7 2.1 3 2.1 4a2.1 2.1 0 0 1-4.2 0c0-1 .5-2.3 2.1-4z" />
      <path d="M10.1 10.4h3.8v8.1h-3.8z" />
      <path d="M11.2 10.4V9" />
      <path d="M6.2 20.6h11.6" />
      <path d="M8 18.5h8" />
    </Svg>
  );
}

export function D20(props: P) {
  return (
    <Svg {...props}>
      <path d="M12 2.6 20.2 7.3v9.4L12 21.4l-8.2-4.7V7.3z" />
      <path d="M12 7.3 16.4 15H7.6z" />
      <path d="M12 2.6v4.7M3.8 7.3l3.8 7.7M20.2 7.3 16.4 15M7.6 15 12 21.4 16.4 15" />
    </Svg>
  );
}

export function Chest(props: P) {
  return (
    <Svg {...props}>
      <path d="M3.8 10.2h16.4v8.6a1.2 1.2 0 0 1-1.2 1.2H5a1.2 1.2 0 0 1-1.2-1.2z" />
      <path d="M3.8 10.2V8.4A4.4 4.4 0 0 1 8.2 4h7.6a4.4 4.4 0 0 1 4.4 4.4v1.8" />
      <path d="M3.8 13.6h5.9M14.3 13.6h5.9" />
      <rect x="9.7" y="11.9" width="4.6" height="4.4" rx="0.8" />
      <path d="M12 13.5v1.3" />
    </Svg>
  );
}

export function Tome(props: P) {
  return (
    <Svg {...props}>
      <path d="M5 5a2 2 0 0 1 2-2h11.5v15H7a2 2 0 0 0-2 2z" />
      <path d="M5 20a2 2 0 0 0 2 1h11.5v-3" />
      <path d="M18.5 8.2H20v4.6h-1.5" />
      <path d="M9 7.2h5.5M9 10.2h3.5" />
    </Svg>
  );
}

export function Lens(props: P) {
  return (
    <Svg {...props}>
      <circle cx="10.4" cy="10.4" r="6.4" />
      <path d="m15.2 15.2 5.4 5.4" />
      <path d="M10.4 7.2v6.4M7.6 8.8l5.6 3.2M13.2 8.8l-5.6 3.2" />
    </Svg>
  );
}

export function Scales(props: P) {
  return (
    <Svg {...props}>
      <path d="M12 4.6v15.8M8.2 20.4h7.6" />
      <path d="M4.6 7.2h14.8" />
      <circle cx="12" cy="3.6" r="1" />
      <path d="M4.6 7.2 2 12.6a2.9 2.9 0 0 0 5.2 0z" />
      <path d="M19.4 7.2 16.8 12.6a2.9 2.9 0 0 0 5.2 0z" />
    </Svg>
  );
}

export function Coins(props: P) {
  return (
    <Svg {...props}>
      <ellipse cx="9" cy="6.2" rx="5.2" ry="2.3" />
      <path d="M3.8 6.2v3.9c0 1.3 2.3 2.3 5.2 2.3s5.2-1 5.2-2.3V6.2" />
      <path d="M3.8 10.1V14c0 1.3 2.3 2.3 5.2 2.3.9 0 1.8-.1 2.5-.3" />
      <ellipse cx="16.2" cy="14.8" rx="4.6" ry="2.1" />
      <path d="M11.6 14.8v3.3c0 1.2 2.1 2.1 4.6 2.1s4.6-.9 4.6-2.1v-3.3" />
    </Svg>
  );
}

export function Tankard(props: P) {
  return (
    <Svg {...props}>
      <path d="M4.8 8.2h10.4v10.6a2 2 0 0 1-2 2H6.8a2 2 0 0 1-2-2z" />
      <path d="M15.2 10.4h2.2a2.2 2.2 0 0 1 2.2 2.2v1.8a2.2 2.2 0 0 1-2.2 2.2h-2.2" />
      <path d="M4.8 8.2c-.6-2 .9-3.6 2.7-3.3.7-1.4 2.5-2 4-1.2 1.4-.6 3.2.3 3.4 1.9 1.1.4 1.4 1.5.3 2.6" />
      <path d="M8.2 11.4v6M11.6 11.4v6" />
    </Svg>
  );
}

export function Scroll(props: P) {
  return (
    <Svg {...props}>
      <path d="M7.4 3.8H18a2.2 2.2 0 0 1 0 4.4h-.8v10a2.2 2.2 0 0 1-2.2 2.2H6.2" />
      <path d="M7.4 3.8a2.2 2.2 0 0 0-2.2 2.2v12.2a2.2 2.2 0 1 0 4.4 0v-1.6H18" />
      <path d="M10 8.6h4.6M10 11.8h4.6" />
    </Svg>
  );
}

export function CardStack(props: P) {
  return (
    <Svg {...props}>
      <rect x="7.4" y="3.4" width="11.2" height="15.4" rx="1.4" transform="rotate(8 13 11)" />
      <rect x="4.6" y="5.2" width="11.2" height="15.4" rx="1.4" transform="rotate(-6 10.2 12.9)" />
      <path d="M8 9.4h5M8 12.2h3.6" transform="rotate(-6 10.2 12.9)" />
    </Svg>
  );
}

export function Pin(props: P) {
  return (
    <Svg {...props}>
      <path d="M12 21s-6.2-5.6-6.2-10.6a6.2 6.2 0 0 1 12.4 0C18.2 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.3" />
    </Svg>
  );
}

export function Crown(props: P) {
  return (
    <Svg {...props}>
      <path d="m3.6 8.4 4.2 3.8L12 5l4.2 7.2 4.2-3.8-1.7 9.4H5.3z" />
      <path d="M5.3 20h13.4" />
    </Svg>
  );
}

/** Taça: o torneio. */
export function Goblet(props: P) {
  return (
    <Svg {...props}>
      <path d="M7 4h10v4.6a5 5 0 0 1-10 0z" />
      <path d="M7 5.6H4.9a2 2 0 0 0 .5 3.9l1.8.2" />
      <path d="M17 5.6h2.1a2 2 0 0 1-.5 3.9l-1.8.2" />
      <path d="M12 13.6V17" />
      <path d="M8.6 20.2h6.8l-1-3.2H9.6z" />
    </Svg>
  );
}

/** Ampulheta: o relógio da rodada. */
export function Hourglass(props: P) {
  return (
    <Svg {...props}>
      <path d="M6.5 3h11M6.5 21h11" />
      <path d="M7.6 3c0 4.4 4.4 5.4 4.4 9s-4.4 4.6-4.4 9" />
      <path d="M16.4 3c0 4.4-4.4 5.4-4.4 9s4.4 4.6 4.4 9" />
      <path d="M9.8 18.6h4.4" />
    </Svg>
  );
}

/** Marca: carta com lupa sobre a mesa (o reflexo na lente é o brilho do vidro do app). */
export function BrandMark({ size = 30, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...rest}>
      <rect x="5" y="3.5" width="15" height="21" rx="2.4" transform="rotate(-9 12.5 14)" fill="#f2e8d5" stroke="#8d6529" strokeWidth="1.2" />
      <rect x="7.8" y="6.6" width="9.4" height="7.2" rx="1" transform="rotate(-9 12.5 14)" fill="#463524" />
      <path d="M8.9 16.8l7.4-1.2M9.3 19.2l5-.8" stroke="#8d6529" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="20.5" cy="18.5" r="6" fill="#16100c" fillOpacity="0.5" stroke="#ebc674" strokeWidth="2" />
      <path d="M17.6 16.2a3.6 3.6 0 0 1 3.6-1.4" stroke="#fbeccb" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
      <path d="m25 23 4 4" stroke="#ebc674" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
