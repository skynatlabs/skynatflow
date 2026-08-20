// The Flow infinity mark as inline SVG — used wherever the full raster
// wordmark (public/brand/flow-logo.png, white background baked in) would
// look wrong: dark surfaces, small badge sizes, favicon-scale contexts.
// Matches the brand gradient: orange -> magenta -> violet -> blue.

export function FlowMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="flowMarkGradient" x1="2" y1="24" x2="46" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff8a3d" />
          <stop offset="38%" stopColor="#ec4899" />
          <stop offset="65%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path
        d="M24 24C24 17 19 12 13 12C7 12 2 17 2 24C2 31 7 36 13 36C19 36 22 31 24 24C26 17 29 12 35 12C41 12 46 17 46 24C46 31 41 36 35 36C29 36 24 31 24 24Z"
        stroke="url(#flowMarkGradient)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
