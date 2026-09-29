const fs = require("fs");

const GITHUB_TOKEN = process.env.GIT_TOKEN;
const PLUGINS_DATA_PATH = "plugins_data.json";
const README_PATH = "README.md";
// 写入 manifest 内的权威来源字段：值为可直接点击跳转的完整 URL
// （https://github.com/<owner>/<name>）。命名加前缀避免与插件自身字段冲突；
// 抓取时强制覆盖 manifest 自带值，客户端以此为准即可区分 fork / 改名导致的
// updateUrl/home 不一致，无需再拼接。
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
    if (!GITHUB_TOKEN) throw new Error("缺少 GIT_TOKEN 环境变量");

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

    // 按 repo 字节序排序后落盘：消除 GitHub search 返回顺序抖动带来的
    // 全文件 diff / 无意义 commit / tag 膨胀（README 展示排序不受影响）。
    const allResults = [...byRepo.values()].sort((a, b) =>
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
    console.log(`成功保存插件: ${allResults.length}`);
  } catch (error) {
    console.error("运行出错:", error.message);
    process.exitCode = 1;
  }
}

run();
