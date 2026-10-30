// Generates metrics.svg with the most used languages across all owned repositories,
// private ones included. Needs only a fine-grained token with "Metadata: Read-only":
// it reads repository language byte counts, never repository contents or names.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

const COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Java: '#b07219',
  'C#': '#178600', Go: '#00ADD8', Rust: '#dea584', Kotlin: '#A97BFF', Dart: '#00B4AB',
  HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Vue: '#41b883', Astro: '#ff5a03',
  Shell: '#89e051', PowerShell: '#012456', Dockerfile: '#384d54', 'Jupyter Notebook': '#DA5B0B',
  SQL: '#e38c00', PLpgSQL: '#336790', TeX: '#3D6117', MDX: '#fcb32c', Svelte: '#ff3e00',
};

async function request(path, token) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  return { data: await res.json(), next };
}

async function listRepos(token) {
  const repos = [];
  let url = '/user/repos?affiliation=owner&per_page=100';
  while (url) {
    const { data, next } = await request(url, token);
    repos.push(...data);
    url = next;
  }
  return repos.filter((repo) => !repo.fork);
}

export async function collectLanguages(token, ignored) {
  const repos = await listRepos(token);
  const totals = new Map();
  for (const repo of repos) {
    const { data } = await request(`/repos/${repo.full_name}/languages`, token);
    for (const [language, bytes] of Object.entries(data)) {
      if (ignored.has(language.toLowerCase())) continue;
      totals.set(language, (totals.get(language) ?? 0) + bytes);
    }
  }
  return { totals, repoCount: repos.length };
}

const escapeXml = (text) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function renderCard(totals, repoCount, limit = 8) {
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((acc, [, bytes]) => acc + bytes, 0) || 1;
  const top = sorted.slice(0, limit).map(([name, bytes]) => ({
    name,
    percent: (bytes / sum) * 100,
    color: COLORS[name] ?? '#8b949e',
  }));

  const width = 540;
  const barWidth = width - 50;
  let x = 25;
  const segments = top
    .map(({ percent, color }) => {
      const w = (percent / 100) * barWidth;
      const rect = `<rect x="${x.toFixed(2)}" y="62" width="${w.toFixed(2)}" height="10" fill="${color}"/>`;
      x += w;
      return rect;
    })
    .join('');

  const rows = Math.ceil(top.length / 2);
  const items = top
    .map(({ name, percent, color }, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ix = 25 + col * (width / 2 - 10);
      const iy = 100 + row * 26;
      return `<g transform="translate(${ix},${iy})" class="item" style="animation-delay:${150 + i * 120}ms">
      <circle cx="5" cy="-4" r="5" fill="${color}"/>
      <text x="18" y="0" class="lang">${escapeXml(name)}</text>
      <text x="${width / 2 - 45}" y="0" class="pct" text-anchor="end">${percent.toFixed(1)}%</text>
    </g>`;
    })
    .join('\n    ');

  const height = 100 + rows * 26 + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Most used languages">
  <style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, sans-serif; fill: #00FF7F; }
    .sub { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; }
    .lang { font: 400 13px 'Segoe UI', Ubuntu, sans-serif; fill: #e6edf3; }
    .pct { font: 600 13px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; }
    .item { opacity: 0; animation: fade 0.4s ease-out forwards; }
    .bar { animation: grow 1s ease-out forwards; transform-origin: left; transform: scaleX(0); }
    @keyframes fade { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleX(1); } }
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#0D1117" stroke="#30363d"/>
  <text x="25" y="35" class="title">Most Used Languages</text>
  <text x="${width - 25}" y="35" class="sub" text-anchor="end">${repoCount} repositories · public &amp; private</text>
  <clipPath id="bar"><rect x="25" y="62" width="${barWidth}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)" class="bar">${segments}</g>
    ${items}
</svg>
`;
}

async function main() {
  const token = process.env.METRICS_TOKEN;
  if (!token) throw new Error('METRICS_TOKEN is not set');
  const ignored = new Set(
    (process.env.IGNORED_LANGUAGES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  const { totals, repoCount } = await collectLanguages(token, ignored);
  await writeFile(process.env.OUTPUT ?? 'metrics.svg', renderCard(totals, repoCount));
  console.log(`Rendered ${totals.size} languages from ${repoCount} repositories`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
