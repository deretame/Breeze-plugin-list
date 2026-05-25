# Breeze Plugin List

通过 GitHub Actions 自动生成 `plugins_data.json`，并使用 jsDelivr 提供 CDN 加速。

## 获取地址

推荐直接使用 `latest`：

```text
https://cdn.jsdelivr.net/gh/deretame/Breeze-plugin-list@latest/plugins_data.json
```

也可以使用 GitHub 原始地址：

```text
https://raw.githubusercontent.com/deretame/Breeze-plugin-list/main/plugins_data.json
```

## 为什么可以使用 `latest`

仓库在每次 `plugins_data.json` 发生变化后，都会自动创建一个新的语义化版本 tag：

```text
0.0.1
0.0.2
0.0.3
...
```

jsDelivr 会根据最新的 semver tag 解析 `@latest`，因此可以直接通过下面这个地址获取当前最新版本：

```text
https://cdn.jsdelivr.net/gh/deretame/Breeze-plugin-list@latest/plugins_data.json
```

## 说明

- `@latest` 适合直接消费最新数据
- 指定版本更稳定，例如：

```text
https://cdn.jsdelivr.net/gh/deretame/Breeze-plugin-list@0.0.1/plugins_data.json
```

- jsDelivr 存在 CDN 缓存，tag 更新后不会在所有节点瞬时生效
