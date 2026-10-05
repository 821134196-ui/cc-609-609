/// 生成简易 SVG 头像（data URI），本地模拟证件照
export function avatarDataUri(name: string, seed?: string): string {
  const key = (seed ?? name).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [200, 20, 140, 280, 30, 170, 0, 90, 320, 50];
  const h = hues[key % hues.length];
  const initials = name.slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <rect width="160" height="160" fill="hsl(${h},45%,55%)"/>
  <circle cx="80" cy="62" r="30" fill="rgba(255,255,255,0.92)"/>
  <path d="M30 150 a50 50 0 0 1 100 0" fill="rgba(255,255,255,0.92)"/>
  <text x="80" y="74" font-size="34" text-anchor="middle" fill="hsl(${h},45%,35%)" font-family="sans-serif">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
