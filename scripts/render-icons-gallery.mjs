/**
 * Render every icon from @deepseek-ai/dsh-client-ui-primitives into a
 * standalone HTML gallery (icons-gallery.html) so they can be viewed without
 * the DSH app. Parses the package's icons source (each icon is a pure SVG
 * component), extracts each SVG body, and lays them out in a grid with the
 * component name + figma glyph name + default size.
 *
 * Run: node scripts/render-icons-gallery.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ICONS_SRC = join(
  process.env.HOME,
  '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-primitives/src/icons/index.tsx',
)
const OUT = join(process.cwd(), 'icons-gallery.html')

const src = readFileSync(ICONS_SRC, 'utf8')

// Each icon: /** comment */ export const Name = ({ size = N, className }: IconProps) => (
//   <svg ...attrs...>...body...</svg>
// )
const entryRe = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*export const (Icon\w+) = \(\{ size = (\d+), className \}: IconProps\) => \(\s*<svg([^>]*)>([\s\S]*?)<\/svg>\s*\)/g

const icons = []
let m
while ((m = entryRe.exec(src)) !== null) {
  const [, comment, name, defaultSize, svgAttrs, body] = m
  // Collapse multi-line /** */ comments (continuation lines start with " * ").
  const cleanComment = comment
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
  const viewBox = /viewBox="([^"]*)"/.exec(svgAttrs)?.[1] ?? '0 0 16 16'
  // Neutralize JSX expressions: {14} -> 14 (rect w/h inside clipPaths/masks).
  let inner = body.replace(/\{(\d+)\}/g, '$1')
  // Make every mask/clipPath id unique per icon so they never collide in one doc.
  const idRe = /\bid="([^"]+)"/g
  let idMatch
  const seen = new Set()
  while ((idMatch = idRe.exec(inner)) !== null) {
    const id = idMatch[1]
    if (seen.has(id)) continue
    seen.add(id)
    inner = inner.split(`id="${id}"`).join(`id="${name}_${id}"`)
    inner = inner.split(`url(#${id})`).join(`url(#${name}_${id})`)
  }
  icons.push({ name, comment: cleanComment, size: Number(defaultSize), viewBox, inner })
}

// Render one <svg> at a given pixel size.
const svg = (icon, px) =>
  `<svg width="${px}" height="${px}" viewBox="${icon.viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">${icon.inner}</svg>`

const cards = icons
  .map((icon) => `
    <div class="cell" data-name="${icon.name.toLowerCase()}">
      <div class="glyph">${svg(icon, 40)}</div>
      <div class="glyph-sm">${svg(icon, 20)}</div>
      <div class="name">${icon.name}</div>
      <div class="figma">${icon.comment}</div>
      <div class="size">default ${icon.size}px</div>
    </div>`)
  .join('')

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-client-ui-primitives icons (${icons.length})</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg, #f7f7f8); color: #1f2328;
  }
  @media (prefers-color-scheme: dark) {
    body { --bg: #141416; --panel: #1e1e21; --border: #34343a; --fg: #e6e6e9; --sub: #9a9aa3; }
  }
  body { --panel: #ffffff; --border: #e2e2e8; --sub: #6b6b76; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 16px; color: var(--sub); font-size: 13px; }
  #filter {
    width: 100%; max-width: 420px; margin-bottom: 20px; padding: 9px 12px;
    border: 1px solid var(--border); border-radius: 10px;
    background: var(--panel); color: inherit; font: inherit; font-size: 14px;
  }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;
  }
  .cell {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 14px 10px; border: 1px solid var(--border); border-radius: 12px;
    background: var(--panel);
  }
  .glyph { color: #1f2328; }
  @media (prefers-color-scheme: dark) { .glyph { color: #e6e6e9; } }
  .glyph-sm { color: var(--sub); }
  .name { font-size: 12px; font-weight: 600; text-align: center; word-break: break-all; }
  .figma { font-size: 11px; color: var(--sub); text-align: center; word-break: break-all; }
  .size { font-size: 11px; color: var(--sub); }
  .hidden { display: none; }
</style>
</head>
<body>
  <h1>dsh-client-ui-primitives 图标库（${icons.length} 个）</h1>
  <p class="sub">来源：@deepseek-ai/dsh-client-ui-primitives/src/icons/index.tsx · 大图 40px、小图 20px · 可用上方搜索过滤</p>
  <input id="filter" type="search" placeholder="输入图标名过滤，如 NewChat / Trash / Link…" autofocus>
  <div class="grid">${cards}</div>
<script>
  const input = document.getElementById('filter');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.cell').forEach(cell => {
      cell.classList.toggle('hidden', q !== '' && !cell.dataset.name.includes(q));
    });
  });
</script>
</body>
</html>`

writeFileSync(OUT, html, 'utf8')
console.log(`wrote ${icons.length} icons -> ${OUT}`)
