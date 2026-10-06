const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// token.txt（本地单行 raw token，有无换行都兼容）优先，CI 等无该文件环境回退 GIT_TOKEN。
// 注意：token 只发给 api.github.com，绝不打日志。
function loadGithubToken() {
  try {
    if (fs.existsSync("token.txt")) {
      const token = fs.readFileSync("token.txt", "utf-8").trim();
      if (token) return token;
    }
  } catch {
    // 读不到就走环境变量
  }
  return process.env.GIT_TOKEN || "";
}

const GITHUB_TOKEN = loadGithubToken();
const PLUGINS_DATA_PATH = "plugins_data.json";
const README_PATH = "README.md";
// 包可用性验证的插件级并发上限，避免同时打爆 npm / GitHub API。
const PLUGIN_CONCURRENCY = 5;
// 单个 updateUrl 下附件下载探测的并发上限。
const ASSET_CONCURRENCY = 3;
// 单次网络请求的超时（毫秒）。
const FETCH_TIMEOUT_MS = 15000;
// 写入 manifest 内的权威来源字段：值为可直接点击跳转的完整 URL
// （https://github.com/<owner>/<name>）。命名加前缀避免与插件自身字段冲突；
// 抓取时强制覆盖 manifest 自带值，客户端以此为准即可区分 fork / 改名导致的
// updateUrl/home 不一致，无需再拼接。
const REPO_FIELD = "breeze-plugin-github-repository";
const EXAMPLE_REPO = "deretame/Breeze-plugin-example";

async function fetchPage(cursor = null) {
  // 定义带变量的 GraphQL 查询
  // after: 传入游标，告诉 GitHub 从哪里开始查
  const query = `
  query($after: String) {
    search(query: "Breeze-plugin in:name", type: REPOSITORY, first: 50, after: $after) {
      repositoryCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on Repository {
          name
          fullName: nameWithOwner
          manifest: object(expression: "HEAD:manifest.json") {
            ... on Blob {
              text
            }
          }
        }
      }
    }
  }`;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Nodejs-Script",
    },
    body: JSON.stringify({
      query,
      variables: { after: cursor },
    }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.data.search;
}

// 剥离 function（保留字/不可序列化风险）与旧的 REPO_FIELD，后者由调用方按当前
// 仓库 fullName 重新写成完整 URL，保证来源权威且键序稳定（该字段恒为最后一个键）。
function normalizeManifest(manifest, repo) {
  const { function: _ignoredFunction, [REPO_FIELD]: _ignoredRepo, ...rest } = manifest;
  return { ...rest, [REPO_FIELD]: `https://github.com/${repo}` };
}

// 简单限流 map：保持输入顺序，同一时刻最多 `limit` 个飞行中任务。
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// npm 存在性：外包给 pnpm view（它处理 registry/auth/代理等细节）。
// 必须带 --json：非 json 模式下「包不存在」也可能 exit 0（上面实测过），
// json 模式命中为裸版本号、exit 0；404 时报 ERR_PNPM_FETCH_404、exit 1。
async function npmPackageExists(npmName) {
  if (!npmName || typeof npmName !== "string" || !npmName.trim()) return false;
  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["view", npmName.trim(), "version", "--json"],
      { timeout: FETCH_TIMEOUT_MS },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// token 只发给 api.github.com：updateUrl 是 manifest 自带的任意外链，子串匹配
// 会被 `https://evil.example/?x=api.github.com` 绕过，必须比对 hostname。
function isGithubApiUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "api.github.com";
  } catch {
    return false;
  }
}

async function fetchJson(url, { label }) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Nodejs-Script",
      Accept: "application/json",
      ...(isGithubApiUrl(url) && GITHUB_TOKEN
        ? { Authorization: `Bearer ${GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 返回的不是 JSON`);
  }
}

// updateUrl 正常 = 返回对象带非空 assets[]，且至少一个 browser_download_url 可下载。
// 只认「可下载」的原因：release 存在但附件被删/上传失败也算无包可装。
async function releaseHasDownloadableAsset(updateUrl) {
  const payload = await fetchJson(updateUrl, { label: "updateUrl" });
  const assets = Array.isArray(payload?.assets)
    ? payload.assets
        .map((a) => a?.browser_download_url)
        .filter((u) => typeof u === "string" && u.length > 0)
    : [];
  if (assets.length === 0) return false;
  const probes = await mapWithConcurrency(
    assets,
    ASSET_CONCURRENCY,
    async (assetUrl) => {
      try {
        // 先 HEAD（便宜）；不支持 HEAD 的直链回退 Range GET 只取 1 字节。
        const head = await fetch(assetUrl, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (head.ok) {
          try {
            await head.body?.cancel();
          } catch {
            // 忽略取消时的底层错误
          }
          return true;
        }
        if (head.status !== 405 && head.status !== 501) return false;
      } catch {
        return false;
      }
      try {
        const ranged = await fetch(assetUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { Range: "bytes=0-0" },
        });
        try {
          await ranged.body?.cancel();
        } catch {
          // 忽略取消时的底层错误
        }
        return ranged.ok;
      } catch {
        return false;
      }
    },
  );
  return probes.some(Boolean);
}

// 包存在性判定：有 npmName 先查 npm，命中直接算存在；否则查 updateUrl。
// 两个通道都不可用/异常 → 视为无包（调用方剔除该仓库）。
async function pluginHasPackage({ repo, manifest }) {
  if (manifest.npmName) {
    if (await npmPackageExists(manifest.npmName)) return true;
    console.log(`! npm 不存在: ${repo} (${manifest.npmName})，改查 updateUrl`);
  }
  if (!manifest.updateUrl) {
    console.log(`! 无可用包: ${repo}（无 npmName、无 updateUrl）`);
    return false;
  }
  try {
    if (await releaseHasDownloadableAsset(manifest.updateUrl)) return true;
    console.log(`! 无可用包: ${repo}（updateUrl 无可下载附件）`);
    return false;
  } catch (e) {
    console.log(`! 无可用包: ${repo}（updateUrl 抓取失败: ${e.message}）`);
    return false;
  }
}

function generatePluginListMarkdown(results) {
  const sortedResults = [...results].sort((a, b) => {
    const nameA = a.manifest.name || a.repo;
    const nameB = b.manifest.name || b.repo;
    return nameA.localeCompare(nameB, "zh-CN");
  });

  const lines = [
    "<!-- PLUGIN_LIST_START -->",
    "<!-- 以下内容由 GitHub Actions 自动更新，请勿手动修改 -->",
    "",
    "| 插件 | 仓库 |",
    "|------|------|",
  ];

  for (const { repo, manifest } of sortedResults) {
    const name = manifest.name || repo;
    const home = manifest.home;
    const repoUrl = `https://github.com/${repo}`;

    const nameCell = home ? `[${name}](${home})` : name;
    const repoCell = `[${repo}](${repoUrl})`;

    lines.push(`| ${nameCell} | ${repoCell} |`);
  }

  lines.push("");
  lines.push("<!-- PLUGIN_LIST_END -->");

  return lines.join("\n");
}

function updateReadme(results) {
  const readmePath = README_PATH;
  if (!fs.existsSync(readmePath)) {
    console.log("! README.md 不存在，跳过更新插件列表");
    return;
  }

  let readme = fs.readFileSync(readmePath, "utf-8");
  const markerStart = "<!-- PLUGIN_LIST_START -->";
  const markerEnd = "<!-- PLUGIN_LIST_END -->";

  const startIndex = readme.indexOf(markerStart);
  const endIndex = readme.indexOf(markerEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    console.log("! README.md 中未找到插件列表占位标记，跳过更新");
    return;
  }

  const newSection = generatePluginListMarkdown(results);

  readme =
    readme.slice(0, startIndex) +
    newSection +
    readme.slice(endIndex + markerEnd.length);

  fs.writeFileSync(readmePath, readme, "utf-8");
  console.log("README.md 插件列表已更新");
}

function isPluginRepo(node) {
  return (
    node &&
    typeof node.name === "string" &&
    node.name.startsWith("Breeze-plugin") &&
    node.fullName !== EXAMPLE_REPO
  );
}

async function run() {
  try {
    if (!GITHUB_TOKEN) throw new Error("缺少 token：本地放 token.txt，CI 用 GIT_TOKEN 环境变量");

    let hasNextPage = true;
    let currentCursor = null;
    const byRepo = new Map();
    let totalProcessed = 0;

    console.log("开始分页抓取 GitHub 数据...");

    while (hasNextPage) {
      const data = await fetchPage(currentCursor);
      const nodes = data.nodes;

      console.log(`正在处理一批数据 (${nodes.length} 个仓库)...`);

      for (const node of nodes) {
        // 过滤逻辑
        if (!isPluginRepo(node)) continue;
        if (!node.manifest || !node.manifest.text) continue;
        if (byRepo.has(node.fullName)) continue;
        try {
          const parsed = JSON.parse(node.manifest.text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("manifest 不是对象");
          }
          byRepo.set(node.fullName, {
            repo: node.fullName,
            manifest: normalizeManifest(parsed, node.fullName),
          });
        } catch (e) {
          console.log(`! 跳过非法格式: ${node.fullName}`);
        }
      }

      // 更新分页状态
      hasNextPage = data.pageInfo.hasNextPage;
      currentCursor = data.pageInfo.endCursor;
      totalProcessed += nodes.length;

      if (hasNextPage) console.log("发现更多页面，继续抓取...");
    }

    // 包存在性验证（并发、限流）：npmName 命中 npm 即收录，否则要求 updateUrl
    // 返回 releases 形 JSON 且至少一个附件可下载；双通道都不满足则剔除
    // （只开了仓库、没发过包/附件的情况）。
    const candidates = [...byRepo.values()];
    console.log(`开始验证包可用性 (${candidates.length} 个候选)...`);
    const checks = await mapWithConcurrency(
      candidates,
      PLUGIN_CONCURRENCY,
      async (entry) => (await pluginHasPackage(entry)) ? entry : null,
    );
    const verified = candidates.filter((_, i) => checks[i]);
    console.log(`包验证通过: ${verified.length}/${candidates.length}`);

    // 按 repo 字节序排序后落盘：消除 GitHub search 返回顺序抖动带来的
    // 全文件 diff / 无意义 commit / tag 膨胀（README 展示排序不受影响）。
    const allResults = verified.sort((a, b) =>
      a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0,
    );

    // 保存到文件
    fs.writeFileSync(
      PLUGINS_DATA_PATH,
      JSON.stringify(allResults, null, 2) + "\n",
      "utf-8",
    );

    // 同步更新 README.md 中的插件列表
    updateReadme(allResults);

    console.log(`\n全部任务完成！`);
    console.log(`累计扫描仓库: ${totalProcessed}`);
    console.log(`候选插件: ${candidates.length}`);
    console.log(`成功保存插件: ${allResults.length}`);
  } catch (error) {
    console.error("运行出错:", error.message);
    process.exitCode = 1;
  }
}

run();
