/**
 * Hero illustration: a three-tier celebration cake on a gold-rimmed stand inside an emerald arch.
 * Pure inline SVG (≈1.7 KB) — no raster image to download, scales crisply on any screen.
 */
export const HeroArt = () => (
  <svg viewBox="0 0 320 420" role="img" aria-label="Cake illustration">
    <defs>
      <linearGradient id="ha-arch" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#14805d" />
        <stop offset="1" stop-color="#06301f" />
      </linearGradient>
      <radialGradient id="ha-glow" cx=".5" cy=".42" r=".55">
        <stop offset="0" stop-color="#e8cf94" stop-opacity=".55" />
        <stop offset="1" stop-color="#e8cf94" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ha-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f3dfa2" />
        <stop offset="1" stop-color="#b98f2e" />
      </linearGradient>
    </defs>
    <path d="M16 420V170C16 78 80 8 160 8s144 70 144 162v250z" fill="url(#ha-arch)" stroke="#c9a24b" stroke-width="2.5" />
    <path d="M32 420V172C32 88 91 24 160 24s128 64 128 148v248z" fill="none" stroke="#e8cf94" stroke-opacity=".45" stroke-width="1.2" />
    <circle cx="160" cy="215" r="150" fill="url(#ha-glow)" />
    <g fill="#e8cf94" opacity=".9">
      <path d="M62 120l3.2 8 8 3.2-8 3.2-3.2 8-3.2-8-8-3.2 8-3.2z" />
      <path d="M262 98l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6z" />
      <path d="M252 214l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" opacity=".7" />
      <circle cx="82" cy="206" r="2.2" /><circle cx="236" cy="150" r="2" />
    </g>
    {/* stand */}
    <ellipse cx="160" cy="362" rx="118" ry="15" fill="url(#ha-gold)" />
    <ellipse cx="160" cy="357" rx="118" ry="14" fill="#f3e6bd" />
    <path d="M150 366h20l6 34h-32z" fill="url(#ha-gold)" />
    <ellipse cx="160" cy="402" rx="40" ry="6" fill="url(#ha-gold)" />
    {/* bottom tier */}
    <path d="M62 290h196v62c0 4-3 6-6 6H68c-3 0-6-2-6-6z" fill="#fbf7ee" />
    <path d="M62 290h196v14c-14 10-28 10-40 0-12 10-26 10-38 0-12 10-26 10-38 0-12 10-26 10-40 0z" fill="#e8cf94" />
    <g fill="#c2456b"><circle cx="86" cy="328" r="5" /><circle cx="120" cy="334" r="5" /><circle cx="160" cy="330" r="5" /><circle cx="200" cy="334" r="5" /><circle cx="234" cy="328" r="5" /></g>
    {/* middle tier */}
    <path d="M92 236h136v56H92z" fill="#fffdf8" />
    <path d="M92 236h136v12c-10 8-22 8-34 0-11 8-23 8-34 0-11 8-23 8-34 0z" fill="#d9b968" />
    <path d="M110 268h100" stroke="#c9a24b" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" />
    {/* top tier */}
    <path d="M118 188h84v50h-84z" fill="#fbf7ee" />
    <path d="M118 188h84v11c-9 7-19 7-28 0-9 7-19 7-28 0z" fill="#e8cf94" />
    {/* topper */}
    <circle cx="160" cy="174" r="11" fill="#c2456b" />
    <path d="M160 163c0-9 4-15 12-18" fill="none" stroke="#7a8f39" stroke-width="3" stroke-linecap="round" />
    <path d="M168 146c5-4 11-3 14 1-5 4-11 4-14-1z" fill="#7a8f39" />
    <circle cx="156" cy="170" r="3" fill="#fff" opacity=".6" />
  </svg>
);
