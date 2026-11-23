import { ImageResponse } from 'next/og';

// Home-screen icon (iOS needs a PNG): same design as app/icon.svg, with more padding.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'linear-gradient(135deg, #6366f1, #3730a3)', padding: '0 0 30px', gap: 0 }}>
        <div style={{ width: 42, height: 58, background: '#c7cdd8', borderRadius: 8, marginRight: -2 }} />
        <div style={{ width: 56, height: 92, background: 'linear-gradient(#fbd46a, #e3a92b)', borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <div style={{ width: 0, height: 0, borderTop: '18px solid transparent', borderBottom: '18px solid transparent',
            borderLeft: '29px solid #ffffff', marginLeft: 6 }} />
        </div>
        <div style={{ width: 42, height: 42, background: '#d89a63', borderRadius: 8, marginLeft: -2 }} />
      </div>
    ),
    size,
  );
}
