import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME || "xiaoben520";
const token = process.env.GITHUB_TOKEN;
const outputPath = "assets/language-stats.svg";
const colors = {
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#663399",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#a97bff",
  Python: "#3572A5",
  TypeScript: "#3178c6",
  Vue: "#41b883",
};
const fallbackColors = ["#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#84cc16"];

async function github(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `${username}-profile-language-chart`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function getRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const result = await github(`/users/${username}/repos?type=owner&per_page=100&page=${page}`);
    repositories.push(...result);
    if (result.length < 100) break;
  }

  return repositories.filter((repository) =>
    !repository.fork && !repository.archived && repository.name !== username
  );
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderChart(entries) {
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const radius = 86;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = entries.map((entry, index) => {
    const length = totalBytes ? (entry.bytes / totalBytes) * circumference : 0;
    const color = colors[entry.name] || fallbackColors[index % fallbackColors.length];
    const segment = `<circle cx="160" cy="160" r="${radius}" fill="none" stroke="${color}" stroke-width="34" stroke-dasharray="${length.toFixed(3)} ${(circumference - length).toFixed(3)}" stroke-dashoffset="-${offset.toFixed(3)}" />`;
    offset += length;
    return segment;
  }).join("\n    ");

  const legend = entries.map((entry, index) => {
    const column = Math.floor(index / 5);
    const row = index % 5;
    const x = 315 + column * 230;
    const y = 91 + row * 40;
    const color = colors[entry.name] || fallbackColors[index % fallbackColors.length];
    const percentage = totalBytes ? (entry.bytes / totalBytes) * 100 : 0;
    return `<g transform="translate(${x} ${y})"><circle cx="7" cy="-5" r="6" fill="${color}" /><text x="22" class="language">${escapeXml(entry.name)}</text><text x="22" y="17" class="percentage">${percentage.toFixed(percentage < 1 ? 2 : 1)}%</text></g>`;
  }).join("\n    ");

  const emptyState = entries.length ? "" : '<text x="160" y="165" text-anchor="middle" class="empty">No language data</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="320" viewBox="0 0 780 320" role="img" aria-labelledby="title description">
  <title id="title">Top languages in ${escapeXml(username)}'s public repositories</title>
  <desc id="description">A donut chart showing up to ten languages, measured by code size.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .title { font-size: 20px; font-weight: 650; }
    .subtitle, .percentage { font-size: 12px; fill: #656d76; }
    .language { font-size: 14px; font-weight: 600; }
    .count { font-size: 30px; font-weight: 700; }
    .empty { font-size: 13px; fill: #656d76; }
    @media (prefers-color-scheme: dark) {
      text { fill: #f0f6fc; }
      .subtitle, .percentage, .empty { fill: #8b949e; }
      .track { stroke: #30363d; }
    }
  </style>
  <text x="24" y="32" class="title">Top Languages</text>
  <text x="24" y="52" class="subtitle">Public, non-fork repositories · up to 10 languages</text>
  <g transform="rotate(-90 160 160)">
    <circle class="track" cx="160" cy="160" r="${radius}" fill="none" stroke="#d0d7de" stroke-width="34" />
    ${segments}
  </g>
  ${emptyState}
  <text x="160" y="154" text-anchor="middle" class="count">${entries.length}</text>
  <text x="160" y="176" text-anchor="middle" class="subtitle">languages</text>
  ${legend}
</svg>
`;
}

const totals = new Map();
const repositories = await getRepositories();

for (const repository of repositories) {
  const languages = await github(`/repos/${username}/${repository.name}/languages`);
  for (const [name, bytes] of Object.entries(languages)) {
    totals.set(name, (totals.get(name) || 0) + bytes);
  }
}

const topLanguages = [...totals.entries()]
  .map(([name, bytes]) => ({ name, bytes }))
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 10);

await mkdir("assets", { recursive: true });
await writeFile(outputPath, renderChart(topLanguages), "utf8");
console.log(`Updated ${outputPath} with ${topLanguages.length} languages.`);
