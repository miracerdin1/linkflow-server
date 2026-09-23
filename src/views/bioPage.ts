import escapeHtml from "escape-html";

import { isSafeExternalUrl } from "../utils/url";
import { isHexColor } from "../utils/validation";

/**
 * The public bio page (/bio/:username): profile header, rows of link cards
 * drifting in opposite directions, then the folders as a table of contents
 * with each folder's full list below it. Plain HTML and CSS, no script.
 * Fonts and colours follow the app (Inter + Fraunces, the preset palettes).
 */

export interface BioLink {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

export interface BioFolder {
  name: string;
  color?: string;
  links: BioLink[];
}

export interface BioPageData {
  name: string;
  username: string;
  bio: string;
  avatarUrl?: string;
  theme?: string;
  folders: BioFolder[];
  /** Public links outside any public folder. */
  looseLinks: BioLink[];
  /** Every public link, newest first: feeds the drifting rows. */
  recent: BioLink[];
}

interface Palette {
  accent: string;
  accentSoft: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
}

// Same presets the app offers; the stored theme id picks one.
const PALETTES: Record<string, Palette> = {
  "purple-dark": { accent: "#3157D5", accentSoft: "#E1E8FF", bg: "#F5F7FB", surface: "#FFFFFF", text: "#162033", muted: "#667085", border: "#DCE2EC" },
  sunset: { accent: "#D95D39", accentSoft: "#FFE2D8", bg: "#FFF7F3", surface: "#FFFFFF", text: "#2A1C18", muted: "#7A5D54", border: "#EAD8D0" },
  "nordic-light": { accent: "#34715A", accentSoft: "#DCEBE4", bg: "#F4F7F4", surface: "#FFFFFF", text: "#17251F", muted: "#5B6B63", border: "#D5E1DA" },
  glassmorphic: { accent: "#6D52B5", accentSoft: "#EAE3FA", bg: "#F8F6FC", surface: "#FFFFFF", text: "#211A2D", muted: "#6B6479", border: "#E1DAEB" },
};

/** Cards in the drifting rows, at most. */
const MAX_SHOWCASE = 24;
/** Below this many links the rows would look sparse; the page skips them. */
const MIN_SHOWCASE = 4;

const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const e = (value: unknown) => escapeHtml(String(value ?? ""));
const href = (url: string) => (isSafeExternalUrl(url) ? e(url) : "#");
const siteOf = (link: BioLink) => link.siteName?.trim() || hostname(link.url);
const titleOf = (link: BioLink) => link.title?.trim() || siteOf(link) || link.url;

/** A preview image, or the site's initial on a tinted block when there is none. */
function thumb(link: BioLink, cls: string) {
  if (link.imageUrl && isSafeExternalUrl(link.imageUrl)) {
    return `<img class="${cls}" src="${e(link.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  const initial = (siteOf(link)[0] || "#").toLocaleUpperCase("tr-TR");
  return `<span class="${cls} thumb-fallback" aria-hidden="true">${e(initial)}</span>`;
}

function showcaseCard(link: BioLink, hidden: boolean) {
  const aria = hidden ? ` aria-hidden="true" tabindex="-1"` : "";
  return `<a class="lc" href="${href(link.url)}" target="_blank" rel="noopener noreferrer"${aria}>
      ${thumb(link, "lc-img")}
      <span class="lc-body"><span class="lc-title">${e(titleOf(link))}</span><span class="lc-site">${e(siteOf(link))}</span></span>
    </a>`;
}

function showcase(links: BioLink[]) {
  if (links.length < MIN_SHOWCASE) return "";
  const picked = links.slice(0, MAX_SHOWCASE);
  const rowCount = picked.length >= 12 ? 3 : picked.length >= 6 ? 2 : 1;
  const rows: BioLink[][] = Array.from({ length: rowCount }, () => []);
  picked.forEach((link, i) => rows[i % rowCount].push(link));

  return `<div class="mq" role="region" aria-label="Son eklenen bağlantılar">${rows
    .map((row, r) => {
      // Short rows repeat so one copy is always wider than the screen.
      const filled: BioLink[] = [];
      while (filled.length < 6) filled.push(...row);
      const seconds = filled.length * 9 + r * 7;
      const first = filled.map((link, i) => showcaseCard(link, i >= row.length)).join("");
      const second = filled.map((link) => showcaseCard(link, true)).join("");
      return `<div class="mq-row${r % 2 ? " rev" : ""}"><div class="mq-track" style="--dur:${seconds}s">${first}${second}</div></div>`;
    })
    .join("")}</div>`;
}

function linkRow(link: BioLink) {
  return `<a class="row" href="${href(link.url)}" target="_blank" rel="noopener noreferrer">
      ${thumb(link, "row-img")}
      <span class="row-body">
        <span class="row-title">${e(titleOf(link))}</span>
        ${link.description ? `<span class="row-desc">${e(link.description)}</span>` : ""}
        <span class="row-site">${e(siteOf(link))}</span>
      </span>
    </a>`;
}

export function renderBioPage(data: BioPageData): string {
  const p = PALETTES[data.theme ?? ""] ?? PALETTES["purple-dark"];
  const groups = [
    ...data.folders.filter((f) => f.links.length > 0).map((f) => ({ name: f.name, color: f.color, links: f.links })),
    ...(data.looseLinks.length ? [{ name: "Genel bağlantılar", color: undefined, links: data.looseLinks }] : []),
  ];
  const all = groups.flatMap((g) => g.links);
  const total = all.length;
  const folderCount = data.folders.filter((f) => f.links.length > 0).length;
  const stat = [`${total} herkese açık link`, folderCount ? `${folderCount} klasör` : ""].filter(Boolean).join(", ");

  const avatar =
    data.avatarUrl && isSafeExternalUrl(data.avatarUrl)
      ? `<img class="avatar" src="${e(data.avatarUrl)}" alt="">`
      : `<div class="avatar" aria-hidden="true">${e((data.name[0] || "?").toLocaleUpperCase("tr-TR"))}</div>`;

  const toc = groups.length
    ? `<nav class="toc" aria-label="Klasörler">
        <div class="toc-h">Klasörler</div>
        ${groups
          .map(
            (g, i) => `<a class="toc-row" href="#klasor-${i + 1}">
              <span class="toc-name">${e(g.name)}</span>
              <span class="toc-sub">${g.links.length} link</span>
              <span class="toc-thumbs" aria-hidden="true">${g.links.slice(0, 3).map((l) => thumb(l, "toc-img")).join("")}</span>
            </a>`,
          )
          .join("")}
      </nav>`
    : "";

  const sections = groups
    .map((g, i) => {
      const color = g.color && isHexColor(g.color) ? g.color : p.muted;
      return `<section class="folder" id="klasor-${i + 1}" style="--folder:${e(color)}">
          <h2>${e(g.name)} <span>${g.links.length}</span></h2>
          <div class="rows">${g.links.map(linkRow).join("")}</div>
        </section>`;
    })
    .join("");

  const shareImage = all.find((l) => l.imageUrl && isSafeExternalUrl(l.imageUrl))?.imageUrl;
  const pageTitle = `${data.name} (@${data.username})`;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${e(pageTitle)} | LinkFlow</title>
  <meta name="description" content="${e(data.bio)}">
  <meta property="og:title" content="${e(pageTitle)}">
  <meta property="og:description" content="${e(data.bio)}">
  ${shareImage ? `<meta property="og:image" content="${e(shareImage)}">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: ${p.accent}; --accent-soft: ${p.accentSoft}; --bg: ${p.bg}; --surface: ${p.surface};
      --text: ${p.text}; --muted: ${p.muted}; --border: ${p.border};
      --serif: "Fraunces", Georgia, "Times New Roman", serif;
      --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.5; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }

    .head { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 56px 20px 34px; }
    .avatar { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font: 700 38px/1 var(--serif); }
    h1 { margin: 6px 0 0; font: 700 clamp(28px, 6vw, 36px)/1.1 var(--serif); letter-spacing: -0.015em; text-wrap: balance; }
    .handle { font: 500 13px/1 var(--sans); color: var(--muted); }
    .bio { margin: 4px 0 0; font: italic 600 17px/1.45 var(--serif); max-width: 34ch; text-wrap: balance; }
    .stat { font: 500 13px/1 var(--sans); color: var(--muted); margin-top: 6px; }

    .mq { display: grid; gap: 14px; padding-bottom: 36px; }
    .mq-row { overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
    .mq-track { display: flex; gap: 14px; width: max-content; padding-block: 8px; animation: drift var(--dur, 60s) linear infinite; }
    .mq-row.rev .mq-track { animation-direction: reverse; }
    .mq-row:hover .mq-track, .mq-row:focus-within .mq-track { animation-play-state: paused; }
    @keyframes drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    .lc { width: 232px; flex: none; display: grid; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; transition: transform .25s cubic-bezier(.2,.7,.2,1), box-shadow .25s; }
    .lc:hover, .lc:focus-visible { transform: translateY(-5px); box-shadow: 0 18px 30px -16px rgba(22,32,51,.4); }
    .lc-img { display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
    .lc-body { display: grid; gap: 5px; padding: 10px 12px 12px; }
    .lc-title { font: 600 14px/1.3 var(--serif); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
    .lc-site { font: 500 11px/1 var(--sans); color: var(--muted); }
    .thumb-fallback { background: linear-gradient(135deg, var(--accent-soft), var(--border)); color: var(--accent); font: 700 28px/1 var(--serif); }

    main { max-width: 720px; margin: 0 auto; padding: 0 20px 24px; }
    .toc-h { font: 700 11px/1 var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); padding-bottom: 12px; border-bottom: 1.5px solid var(--text); }
    .toc-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 18px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--border); }
    .toc-name { font: 600 22px/1.15 var(--serif); letter-spacing: -0.01em; }
    .toc-sub { grid-column: 1; font-size: 13px; color: var(--muted); }
    .toc-thumbs { grid-row: 1 / span 2; grid-column: 2; display: flex; }
    .toc-img { display: grid; place-items: center; width: 54px; height: 40px; border-radius: 6px; object-fit: cover; border: 2px solid var(--bg); margin-left: -14px; font-size: 15px; transition: transform .25s; }
    .toc-row:hover .toc-img:nth-child(1) { transform: translateX(-8px) rotate(-4deg); }
    .toc-row:hover .toc-img:nth-child(3) { transform: translateX(8px) rotate(4deg); }

    .folder { padding-top: 40px; scroll-margin-top: 16px; }
    .folder h2 { margin: 0 0 12px; padding-left: 12px; border-left: 4px solid var(--folder); font: 600 20px/1.2 var(--serif); }
    .folder h2 span { font: 500 13px/1 var(--sans); color: var(--muted); margin-left: 6px; }
    .rows { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 72px 1fr; gap: 14px; align-items: center; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; transition: border-color .2s, transform .2s; }
    .row:hover { border-color: var(--accent); transform: translateY(-2px); }
    .row-img { display: grid; place-items: center; width: 72px; height: 54px; border-radius: 9px; object-fit: cover; font-size: 20px; }
    .row-body { display: grid; gap: 3px; min-width: 0; }
    .row-title { font: 600 15px/1.3 var(--serif); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .row-desc { font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-site { font: 500 11px/1 var(--sans); color: var(--muted); }
    .empty { text-align: center; color: var(--muted); padding: 24px 0 8px; }

    footer { text-align: center; font-size: 12px; color: var(--muted); padding: 32px 20px 48px; }
    footer a { font-weight: 600; color: var(--text); }

    @media (max-width: 520px) { .lc { width: 196px; } .toc-img { width: 42px; height: 32px; } }
    /* No drifting for people who asked for less motion: the rows scroll by hand instead. */
    @media (prefers-reduced-motion: reduce) {
      .mq-track { animation: none; }
      .mq-row { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
      .lc, .row, .toc-img { transition: none; }
    }
  </style>
</head>
<body>
  <header class="head">
    ${avatar}
    <h1>${e(data.name)}</h1>
    <div class="handle">@${e(data.username)}</div>
    ${data.bio ? `<p class="bio">${e(data.bio)}</p>` : ""}
    ${total ? `<div class="stat">${e(stat)}</div>` : ""}
  </header>
  ${showcase(data.recent)}
  <main>
    ${total ? toc + sections : `<p class="empty">Henüz herkese açık bağlantı eklenmemiş.</p>`}
  </main>
  <footer><a href="https://github.com/miracerdin1/mobile" target="_blank" rel="noopener noreferrer">LinkFlow</a> ile derlendi</footer>
</body>
</html>`;
}
