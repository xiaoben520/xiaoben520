import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

const username = process.env.GITHUB_USERNAME || "xiaoben520";
const token = process.env.GITHUB_TOKEN;
const outputPath = "assets/language-stats.svg";

// 技术栈分类（颜色：每个 stack 一种主色，按使用频率排序）
// 思路：把语言归并到"技术栈类别"维度，而不是单独列每种语言。
// 例如：C++ / C# / Java → "C 系 / JVM / 系统级"；HTML / CSS / Vue / TS → "前端 / Web"
const stackPalette = {
  "Backend (C# / .NET)": "#178600",
  "Backend (C++ / Native)": "#f34b7d",
  "Backend (Java / JVM)": "#b07219",
  "Frontend (Web)": "#3178c6",
  "Frontend (Vue)": "#41b883",
  "Frontend (HTML/CSS)": "#e34c26",
  "Scripting (Python)": "#3572A5",
  "Scripting (Shell)": "#89e051",
  "Scripting (PowerShell)": "#012456",
  "Scripting (Lua)": "#000080",
  "Database (SQL)": "#e38c00",
  "Mobile (Swift/Kotlin/Dart)": "#F05138",
  "Build (CMake/Docker)": "#9b59b6",
  "Other": "#656d76",
};
const fallbackStackColors = ["#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#84cc16"];

// 把语言归类到技术栈类别
const languageToStack = new Map([
  // C 系 / .NET 后端
  ["C#", "Backend (C# / .NET)"],
  ["XAML", "Backend (C# / .NET)"],
  // C++ / 系统级
  ["C++", "Backend (C++ / Native)"],
  ["C", "Backend (C++ / Native)"],
  // JVM 后端
  ["Java", "Backend (Java / JVM)"],
  ["Kotlin", "Backend (Java / JVM)"],
  // 前端（Web 主体）
  ["JavaScript", "Frontend (Web)"],
  ["TypeScript", "Frontend (Web)"],
  // Vue 框架
  ["Vue", "Frontend (Vue)"],
  // 标记语言 / 样式
  ["HTML", "Frontend (HTML/CSS)"],
  ["CSS", "Frontend (HTML/CSS)"],
  // 脚本语言
  ["Python", "Scripting (Python)"],
  ["Shell", "Scripting (Shell)"],
  ["PowerShell", "Scripting (PowerShell)"],
  ["Lua", "Scripting (Lua)"],
  // 数据库
  ["SQL", "Database (SQL)"],
  // 移动端
  ["Swift", "Mobile (Swift/Kotlin/Dart)"],
  ["Dart", "Mobile (Swift/Kotlin/Dart)"],
  // 构建 / 容器
  ["CMake", "Build (CMake/Docker)"],
  ["Dockerfile", "Build (CMake/Docker)"],
  // 其他独立栈
  ["Go", "Other"],
  ["PHP", "Other"],
  ["Ruby", "Other"],
  ["Rust", "Other"],
]);

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

// 把语言出现次数累加到技术栈类别
function collectAdditions(output, stackTotals, languageTotals) {
  for (const line of output.split(/\r?\n/)) {
    const [added, , ...filenameParts] = line.split("\t");
    if (!/^\d+$/.test(added) || filenameParts.length === 0) continue;

    const language = languageForFile(filenameParts.join("\t"));
    if (!language) continue;

    // 原始语言统计（保留作图例副信息）
    languageTotals.set(language, (languageTotals.get(language) || 0) + Number(added));

    // 按技术栈聚合
    const stack = languageToStack.get(language);
    if (!stack) continue;
    stackTotals.set(stack, (stackTotals.get(stack) || 0) + Number(added));
  }
}

async function calculateContributedLines(commits) {
  const commitsByRepository = new Map();
  const stackTotals = new Map();
  const languageTotals = new Map();

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
        collectAdditions(output, stackTotals, languageTotals);
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return { stackTotals, languageTotals };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function pickColor(stack, index) {
  return stackPalette[stack] || fallbackStackColors[index % fallbackStackColors.length];
}

function renderChart(stackEntries, languageBreakdown) {
  const totalLines = stackEntries.reduce((sum, entry) => sum + entry.lines, 0);
  const radius = 90;
  const strokeWidth = 32;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  // 在每个区块首尾各留 2px 缝（按周长比例计算），让相邻区块边界清晰
  const segments = stackEntries.map((entry, index) => {
    const length = totalLines ? (entry.lines / totalLines) * circumference : 0;
    const color = pickColor(entry.name, index);
    const gap = totalLines ? (2 / circumference) * circumference : 0;
    const segmentLength = Math.max(length - gap, 0);
    const segment = `<circle cx="180" cy="180" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${segmentLength.toFixed(3)} ${(circumference - segmentLength).toFixed(3)}" stroke-dashoffset="-${offset.toFixed(3)}" />`;
    offset += length;
    return segment;
  }).join("\n    ");

  // 主图例：技术栈 + 占比；副信息：包含哪些语言
  const legend = stackEntries.map((entry, index) => {
    const column = Math.floor(index / 5);
    const row = index % 5;
    const x = 345 + column * 210;
    const y = 75 + row * 44;
    const color = pickColor(entry.name, index);
    const percentage = totalLines ? (entry.lines / totalLines) * 100 : 0;
    const childLangs = (languageBreakdown.get(entry.name) || [])
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 4)
      .map((l) => l.name)
      .join(" · ");
    const subText = childLangs
      ? `<text x="22" y="32" class="sub">${escapeXml(childLangs)}</text>`
      : "";
    return `<g transform="translate(${x} ${y})"><circle cx="7" cy="-5" r="6" fill="${color}" /><text x="22" class="stack">${escapeXml(entry.name)}</text><text x="22" y="17" class="percentage">${percentage.toFixed(percentage < 1 ? 2 : 1)}%</text>${subText}</g>`;
  }).join("\n    ");

  const emptyState = stackEntries.length ? "" : '<text x="180" y="185" text-anchor="middle" class="empty">No contribution data</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="320" viewBox="0 0 820 320" role="img" aria-labelledby="title description">
  <title id="title">Tech stack breakdown in ${escapeXml(username)}'s contributed code</title>
  <desc id="description">A donut chart grouping my authored public commits by tech stack category — backend, frontend, scripting, database, mobile, build — measured by added lines of code.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .title { font-size: 18px; font-weight: 600; fill: #1f2328; }
    .percentage { font-size: 12px; fill: #656d76; }
    .stack { font-size: 14px; font-weight: 600; fill: #1f2328; }
    .sub { font-size: 11px; fill: #8b949e; }
    .count { font-size: 30px; font-weight: 700; fill: #1f2328; }
    .empty { font-size: 13px; fill: #656d76; }
    .track { stroke: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .title, .stack, .count { fill: #f0f6fc; }
      .percentage, .empty { fill: #8b949e; }
      .sub { fill: #6e7681; }
      .track { stroke: #30363d; }
    }
  </style>
  <text x="24" y="32" class="title">Coding Profile · Tech Stack Share</text>
  <g transform="rotate(-90 180 180)">
    <circle class="track" cx="180" cy="180" r="${radius}" fill="none" stroke-width="${strokeWidth}" />
    ${segments}
  </g>
  ${emptyState}
  <text x="180" y="174" text-anchor="middle" class="count">${stackEntries.length}</text>
  <text x="180" y="196" text-anchor="middle" class="percentage">stacks</text>
  ${legend}
</svg>
`;
}

const commits = await getAuthoredCommits();
const { stackTotals, languageTotals } = await calculateContributedLines(commits);

// 按技术栈汇总占比，并按数量倒序
const topStacks = [...stackTotals.entries()]
  .map(([name, lines]) => ({ name, lines }))
  .sort((left, right) => right.lines - left.lines);

// 按语言反查属于哪个 stack（用于副信息展示）
const languageBreakdown = new Map();
for (const [language, lines] of languageTotals.entries()) {
  const stack = languageToStack.get(language);
  if (!stack) continue;
  if (!languageBreakdown.has(stack)) languageBreakdown.set(stack, []);
  languageBreakdown.get(stack).push({ name: language, lines });
}

await mkdir("assets", { recursive: true });
await writeFile(outputPath, renderChart(topStacks, languageBreakdown), "utf8");
console.log(`Updated ${outputPath} from ${commits.length} authored commits across ${topStacks.length} tech stacks.`);