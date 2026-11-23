import { ImageResponse } from 'next/og';

// Home-screen icon (iOS needs a PNG): the same artwork as app/icon.svg, square corners (iOS rounds them).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"> <defs> <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"> <stop offset="0" stop-color="#6366f1"/> <stop offset="1" stop-color="#3730a3"/> </linearGradient> <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"> <stop offset="0" stop-color="#fbd46a"/> <stop offset="1" stop-color="#e3a92b"/> </linearGradient> </defs> <rect width="64" height="64" fill="url(#bg)"/> <path d="M32 5.5l1.9 4.6 4.6 1.9-4.6 1.9L32 18.5l-1.9-4.6-4.6-1.9 4.6-1.9z" fill="#fde68a"/> <rect x="8"  y="34" width="15" height="22" rx="3" fill="#c7cdd8"/> <rect x="41" y="40" width="15" height="16" rx="3" fill="#d89a63"/> <rect x="22" y="22" width="20" height="34" rx="3.5" fill="url(#gold)"/> <path d="M28.5 31.5v13l10.5-6.5z" fill="#ffffff"/> </svg>`;

export default function AppleIcon() {
  // eslint-disable-next-line @next/next/no-img-element
  return new ImageResponse(<img src={`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`} width={180} height={180} alt="" />, size);
}
