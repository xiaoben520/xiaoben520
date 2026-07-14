import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

const username = process.env.GITHUB_USERNAME || "xiaoben520";
const token = process.env.GITHUB_TOKEN;
const outputPath = "assets/language-stats.svg";
const colors = {
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  CSS: "#663399",
  Dart: "#00B4AB",
  Go: "#00ADD8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#a97bff",
  Lua: "#000080",
  PHP: "#4F5D95",
  PowerShell: "#012456",
  Python: "#3572A5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  SQL: "#e38c00",
  Swift: "#F05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
  XAML: "#0C54C2",
};
const fallbackColors = ["#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#84cc16"];
const extensionLanguages = new Map([
  [".c", "C"],
  [".cc", "C++"],
  [".cpp", "C++"],
  [".cxx", "C++"],
  [".h", "C++"],
  [".hh", "C++"],
  [".hpp", "C++"],
  [".cs", "C#"],
  [".css", "CSS"],
  [".dart", "Dart"],
  [".go", "Go"],
  [".htm", "HTML"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".kt", "Kotlin"],
  [".kts", "Kotlin"],
  [".lua", "Lua"],
  [".php", "PHP"],
  [".ps1", "PowerShell"],
  [".py", "Python"],
  [".rb", "Ruby"],
  [".rs", "Rust"],
  [".scss", "CSS"],
  [".sh", "Shell"],
  [".bash", "Shell"],
  [".sql", "SQL"],
  [".swift", "Swift"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".vue", "Vue"],
  [".xaml", "XAML"],
]);

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

async function getAuthoredCommits() {
  const commits = [];
  const query = encodeURIComponent(`author:${username}`);

  for (let page = 1; page <= 10; page += 1) {
    const result = await github(`/search/commits?q=${query}&sort=author-date&order=desc&per_page=100&page=${page}`);
    commits.push(...result.items);
    if (result.items.length < 100) break;
  }

  return commits;
}

function languageForFile(filename) {
  const basename = filename.split("/").at(-1)?.toLowerCase();
  if (basename === "dockerfile") return "Dockerfile";
  if (basename === "cmakelists.txt") return "CMake";
  return extensionLanguages.get(extname(filename).toLowerCase());
}

function collectAdditions(output, totals) {
  for (const line of output.split(/\r?\n/)) {
    const [added, , ...filenameParts] = line.split("\t");
    if (!/^\d+$/.test(added) || filenameParts.length === 0) continue;

    const language = languageForFile(filenameParts.join("\t"));
    if (!language) continue;
    totals.set(language, (totals.get(language) || 0) + Number(added));
  }
}

async function calculateContributedLines(commits) {
  const commitsByRepository = new Map();
  const totals = new Map();

  for (const commit of commits) {
    const repository = commit.repository.full_name;
    if (!commitsByRepository.has(repository)) commitsByRepository.set(repository, new Set());
    commitsByRepository.get(repository).add(commit.sha);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "language-chart-"));

  try {
    for (const [repository, commitShas] of commitsByRepository) {
      const repositoryDirectory = join(temporaryDirectory, repository.replace("/", "--"));
      execFileSync("git", ["clone", "--quiet", "--no-checkout", `https://github.com/${repository}.git`, repositoryDirectory], { stdio: "inherit" });

      for (const commitSha of commitShas) {
        const output = execFileSync("git", ["-C", repositoryDirectory, "show", "--numstat", "--format=", "--no-renames", commitSha], { encoding: "utf8" });
        collectAdditions(output, totals);
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return totals;
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
  const totalLines = entries.reduce((sum, entry) => sum + entry.lines, 0);
  const radius = 90;
  const strokeWidth = 32;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  // 为饼图区段添加细分隔符（背景色细缝），让相邻区块边界清晰
  const segments = entries.map((entry, index) => {
    const length = totalLines ? (entry.lines / totalLines) * circumference : 0;
    const color = colors[entry.name] || fallbackColors[index % fallbackColors.length];
    // 在每个区块首尾各留 2px 缝（按周长比例计算）
    const gap = totalLines ? (2 / circumference) * circumference : 0;
    const segmentLength = Math.max(length - gap, 0);
    const segment = `<circle cx="180" cy="180" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${segmentLength.toFixed(3)} ${(circumference - segmentLength).toFixed(3)}" stroke-dashoffset="-${offset.toFixed(3)}" />`;
    offset += length;
    return segment;
  }).join("\n    ");

  const legend = entries.map((entry, index) => {
    const column = Math.floor(index / 5);
    const row = index % 5;
    const x = 345 + column * 200;
    const y = 75 + row * 44;
    const color = colors[entry.name] || fallbackColors[index % fallbackColors.length];
    const percentage = totalLines ? (entry.lines / totalLines) * 100 : 0;
    return `<g transform="translate(${x} ${y})"><circle cx="7" cy="-5" r="6" fill="${color}" /><text x="22" class="language">${escapeXml(entry.name)}</text><text x="22" y="17" class="percentage">${percentage.toFixed(percentage < 1 ? 2 : 1)}%</text></g>`;
  }).join("\n    ");

  const emptyState = entries.length ? "" : '<text x="180" y="185" text-anchor="middle" class="empty">No contribution data</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="320" viewBox="0 0 780 320" role="img" aria-labelledby="title description">
  <title id="title">Languages in ${escapeXml(username)}'s contributed code</title>
  <desc id="description">A donut chart showing up to ten languages by added lines in public commits authored by ${escapeXml(username)}.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .title { font-size: 18px; font-weight: 600; fill: #1f2328; }
    .percentage { font-size: 12px; fill: #656d76; }
    .language { font-size: 14px; font-weight: 600; fill: #1f2328; }
    .count { font-size: 30px; font-weight: 700; fill: #1f2328; }
    .empty { font-size: 13px; fill: #656d76; }
    .track { stroke: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .title, .language, .count { fill: #f0f6fc; }
      .percentage, .empty { fill: #8b949e; }
      .track { stroke: #30363d; }
    }
  </style>
  <text x="24" y="32" class="title">Coding Profile · Contributed Languages</text>
  <g transform="rotate(-90 180 180)">
    <circle class="track" cx="180" cy="180" r="${radius}" fill="none" stroke-width="${strokeWidth}" />
    ${segments}
  </g>
  ${emptyState}
  <text x="180" y="174" text-anchor="middle" class="count">${entries.length}</text>
  <text x="180" y="196" text-anchor="middle" class="percentage">languages</text>
  ${legend}
</svg>
`;
}

const commits = await getAuthoredCommits();
const totals = await calculateContributedLines(commits);
const topLanguages = [...totals.entries()]
  .map(([name, lines]) => ({ name, lines }))
  .sort((left, right) => right.lines - left.lines)
  .slice(0, 10);

await mkdir("assets", { recursive: true });
await writeFile(outputPath, renderChart(topLanguages), "utf8");
console.log(`Updated ${outputPath} from ${commits.length} authored commits with ${topLanguages.length} languages.`);
