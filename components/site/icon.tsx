// Cinematic icon set — minimal stroke SVGs lifted from the example design.
// Lives outside lucide-react so weights and styles stay consistent across
// the player, paywall and detail page.

export type IconName =
  | "home"
  | "search"
  | "download"
  | "user"
  | "play"
  | "pause"
  | "plus"
  | "check"
  | "share"
  | "settings"
  | "back"
  | "close"
  | "chevron-right"
  | "chevron-down"
  | "volume"
  | "mute"
  | "fullscreen"
  | "rewind"
  | "forward"
  | "subtitle"
  | "cast"
  | "lock"
  | "star"
  | "flame"
  | "info";

export function Icon({
  name,
  size = 20,
  color = "currentColor",
  className,
}: {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
}) {
  const stroke = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  const filled = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: color,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    case "home":
      return (
        <svg {...stroke}>
          <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11z" />
        </svg>
      );
    case "search":
      return (
        <svg {...stroke}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case "download":
      return (
        <svg {...stroke}>
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
      );
    case "user":
      return (
        <svg {...stroke}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      );
    case "play":
      return (
        <svg {...filled}>
          <path d="M7 4.5v15l13-7.5z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...filled}>
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case "plus":
      return (
        <svg {...stroke}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "check":
      return (
        <svg {...stroke}>
          <path d="M5 12l5 5L20 6" />
        </svg>
      );
    case "share":
      return (
        <svg {...stroke}>
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M9 11l6-3M9 13l6 3" />
        </svg>
      );
    case "settings":
      return (
        <svg {...stroke}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "back":
      return (
        <svg {...stroke}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      );
    case "close":
      return (
        <svg {...stroke}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...stroke}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...stroke}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case "volume":
      return (
        <svg {...stroke}>
          <path d="M11 5L6 9H2v6h4l5 4V5zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
        </svg>
      );
    case "mute":
      return (
        <svg {...stroke}>
          <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
        </svg>
      );
    case "fullscreen":
      return (
        <svg {...stroke}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      );
    case "rewind":
      return (
        <svg {...stroke}>
          <path d="M11 19L2 12l9-7v14zM22 19l-9-7 9-7v14z" />
        </svg>
      );
    case "forward":
      return (
        <svg {...stroke}>
          <path d="M13 5l9 7-9 7V5zM2 5l9 7-9 7V5z" />
        </svg>
      );
    case "subtitle":
      return (
        <svg {...stroke}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M7 14h4M7 11h6M13 14h4" />
        </svg>
      );
    case "cast":
      return (
        <svg {...stroke}>
          <path d="M2 17a4 4 0 0 1 4 4M2 13a8 8 0 0 1 8 8M2 9a12 12 0 0 1 12 12" />
          <path d="M22 17V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v3" />
        </svg>
      );
    case "lock":
      return (
        <svg {...stroke}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "star":
      return (
        <svg {...stroke}>
          <path d="M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
        </svg>
      );
    case "flame":
      return (
        <svg {...stroke}>
          <path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-1.5.5-2.5 1.5-3.5C9.5 6 11 5 12 3z" />
        </svg>
      );
    case "info":
      return (
        <svg {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <circle cx="12" cy="8" r="0.4" fill={color} />
        </svg>
      );
  }
}
