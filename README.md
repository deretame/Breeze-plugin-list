# Breeze Plugin List

本仓库是 [Breeze](https://github.com/deretame/Breeze) 的插件索引列表，通过 GitHub Actions 自动扫描并生成 `plugins_data.json`，供 Breeze 客户端拉取与更新插件。

## 相关链接

- **Breeze（插件运行时 / 主项目）**: [https://github.com/deretame/Breeze](https://github.com/deretame/Breeze)
- **插件开发文档**: [https://deretame.github.io/plugin-dev-docs/](https://deretame.github.io/plugin-dev-docs/)

## 插件列表

`plugins_data.json` 中收录了所有符合命名规范（仓库名以 `Breeze-plugin` 开头）的插件仓库信息，包括插件名称、版本、图标、主页及更新地址等。

<!-- PLUGIN_LIST_START -->
<!-- 以下内容由 GitHub Actions 自动更新，请勿手动修改 -->

| 插件 | 仓库 |
|------|------|
| [包子漫画](https://github.com/deretame/Breeze-plugin-baozimh) | [deretame/Breeze-plugin-baozimh](https://github.com/deretame/Breeze-plugin-baozimh) |
| [包子漫画 Plus](https://github.com/Enigma-Soul/Breeze-plugin-baozimh-plus) | [Enigma-Soul/Breeze-plugin-baozimh-plus](https://github.com/Enigma-Soul/Breeze-plugin-baozimh-plus) |
| [哔咔漫画](https://github.com/deretame/Breeze-plugin-bikaComic) | [deretame/Breeze-plugin-bikaComic](https://github.com/deretame/Breeze-plugin-bikaComic) |
| [禁漫天堂](https://github.com/deretame/Breeze-plugin-JmComic) | [deretame/Breeze-plugin-JmComic](https://github.com/deretame/Breeze-plugin-JmComic) |
| [拷贝漫画](https://github.com/deretame/Breeze-plugin-copyComic) | [deretame/Breeze-plugin-copyComic](https://github.com/deretame/Breeze-plugin-copyComic) |
| [漫画柜](https://github.com/deretame/Breeze-plugin-ManHuaGui) | [deretame/Breeze-plugin-ManHuaGui](https://github.com/deretame/Breeze-plugin-ManHuaGui) |
| [如漫画](https://github.com/deretame/Breeze-plugin-RuManHua) | [deretame/Breeze-plugin-RuManHua](https://github.com/deretame/Breeze-plugin-RuManHua) |
| [绅士漫画](https://github.com/deretame/Breeze-plugin-shenShiManHua) | [deretame/Breeze-plugin-shenShiManHua](https://github.com/deretame/Breeze-plugin-shenShiManHua) |
| [蛙漫3](https://github.com/deretame/Breeze-plugin-WaMan3) | [deretame/Breeze-plugin-WaMan3](https://github.com/deretame/Breeze-plugin-WaMan3) |
| [再漫画](https://github.com/deretame/Breeze-plugin-zaiManHuan) | [deretame/Breeze-plugin-zaiManHuan](https://github.com/deretame/Breeze-plugin-zaiManHuan) |
| [e-hentai](https://github.com/deretame/Breeze-plugin-ehentai) | [deretame/Breeze-plugin-ehentai](https://github.com/deretame/Breeze-plugin-ehentai) |
| [Komiic](https://github.com/deretame/Breeze-plugin-komiic) | [deretame/Breeze-plugin-komiic](https://github.com/deretame/Breeze-plugin-komiic) |
| [nhentai](https://github.com/deretame/Breeze-plugin-nhentai) | [deretame/Breeze-plugin-nhentai](https://github.com/deretame/Breeze-plugin-nhentai) |
| [NoyAcg](https://github.com/deretame/Breeze-plugin-NoyAcg) | [deretame/Breeze-plugin-NoyAcg](https://github.com/deretame/Breeze-plugin-NoyAcg) |

<!-- PLUGIN_LIST_END -->

## 自动更新机制

- 工作流定义：`.github/workflows/update-plugins-data.yml`
- 触发方式：
  - 每小时定时执行（`cron: "0 * * * *"`）
  - 手动触发（`workflow_dispatch`）
- 更新流程：
  1. 通过 GitHub GraphQL API 搜索并拉取所有仓库名以 `Breeze-plugin` 开头的仓库；
  2. 读取各仓库根目录下的 `manifest.json` 并合并；
  3. 生成 `plugins_data.json` 并提交；
  4. 当列表发生变化时，自动创建增量 tag，并将版本信息同步至 S3。

## 本地运行

```bash
# 安装依赖
pnpm install

# 生成插件列表（需要设置 GIT_TOKEN）
GIT_TOKEN=<your_github_token> node get-list.js
```

## 贡献插件

如果你想为 Breeze 开发插件，请参考上方的[插件开发文档](https://deretame.github.io/plugin-dev-docs/)。
