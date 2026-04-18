const fs = require("fs");
const GITHUB_TOKEN = process.env.GIT_TOKEN;

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
  return result.data.search;
}

async function run() {
  try {
    let hasNextPage = true;
    let currentCursor = null;
    let allResults = [];
    let totalProcessed = 0;

    console.log("开始分页抓取 GitHub 数据...");

    while (hasNextPage) {
      const data = await fetchPage(currentCursor);
      const nodes = data.nodes;

      console.log(`正在处理一批数据 (${nodes.length} 个仓库)...`);

      for (const node of nodes) {
        // 过滤逻辑
        if (
          node.name.startsWith("Breeze-plugin") &&
          node.fullName !== "deretame/Breeze-plugin-example"
        ) {
          if (node.manifest && node.manifest.text) {
            try {
              allResults.push({
                repo: node.fullName,
                manifest: JSON.parse(node.manifest.text),
              });
            } catch (e) {
              console.log(`! 跳过非法格式: ${node.fullName}`);
            }
          }
        }
      }

      // 更新分页状态
      hasNextPage = data.pageInfo.hasNextPage;
      currentCursor = data.pageInfo.endCursor;
      totalProcessed += nodes.length;

      if (hasNextPage) console.log("发现更多页面，继续抓取...");
    }

    // 保存到文件
    fs.writeFileSync(
      "plugins_data.json",
      JSON.stringify(allResults, null, 2),
      "utf-8",
    );
    console.log(`\n全部任务完成！`);
    console.log(`累计扫描仓库: ${totalProcessed}`);
    console.log(`成功保存插件: ${allResults.length}`);
  } catch (error) {
    console.error("运行出错:", error.message);
  }
}

run();
