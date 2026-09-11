# DSH-Store 上架合规记录

本文件记录本插件对 DSH-Store 上架契约（[DSH-Store `registry/README.md`](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/README.md)）的符合情况与**实测证据**。

> 口径：`package.json` 的 `dsh.compatibility.dshReleases` 里**只有真实跑过一次性 Profile 安装/启动/卸载的版本才写 `compatible`**；
> 未验证的一律 `unknown`。宽泛范围（`dsh` 字段）只作参考，不构成"可安装证据"。

## 一、整改来源

DSH STORE 固定 Commit 自动检查（[Issue #734](https://github.com/AI-Scarlett/DSH-Store/issues/734)）报：

```
候选未保留 / Candidate pruned
SUBMISSION_BUNDLE_MISSING: No package.json declaring dsh.bundle.patch was found;
no exact compatible declaration for official DSH releases 0.1.5-alpha.2, 0.1.5-rc.1, 0.1.5-rc.2
```

逐项对应处理：

| 整改要求 | 本仓处理 |
|---|---|
| manifest 声明 `dsh.bundle.patch` | `package.json` 的 `dsh.bundle.patch` → `./cordis.patch.yml`，且该文件在 `files` 白名单内（git/`node_modules` 安装都会带上） |
| 提升插件 SemVer | `0.1.0` → `0.2.0` |
| 逐版本 `dsh.compatibility.dshReleases` | 官方 npm 发布的 11 个版本逐项列出；见下文实测状态 |
| Patch 只新增唯一自有 entry ID | `cordis.patch.yml` 只插入 1 条 `id: dsh-cost`（小写、无 scope，非官方 ID）；`name` = 包名 |
| 声明 Node / DSH 兼容范围 | `engines.node: ">=22"`、`dsh.compatibility.dsh: ">=0.1.2-alpha.4 <0.2.0"` |
| 移除对 `@deepseek-ai/*` / 受保护组件的替换或冒用 | 删除 `lib/client.js` 里两处自指 `@deepseek-ai/dsh-cost` 字符串；仓库内不再有自指官方 scope（对官方包的**只读引用**如 `@deepseek-ai/dsh-client-ui-conversation` 属正常声明） |
| 一次性 Profile 安装/启动/卸载证据 | 见第二节 |
| 无生命周期脚本、无运行依赖 | `preinstall/install/postinstall/prepare` 全无；无 `dependencies`；已移除多余的 `peerDependencies.react`（React 由宿主注入，不是 npm 依赖） |

## 二、实测证据

### 环境

| 项 | 值 |
|---|---|
| 插件版本 | `@david0702/dsh-cost@0.2.0` |
| DSH 版本 | `0.1.5-rc.1`（npm `dist-tags.latest`） |
| Node | `v24.16.0` |
| DSH_HOME | 一次性临时目录（未触碰真实 `~/.dsh` 的 web profile） |
| 测试 profile | `e3`（`--from-default-profile web` 初始化） |
| 安装方式 | `dsh plugin --profile e3 add D:\dsh\dsh-cost`（路径安装，等价于固定 Commit 的 git 安装） |

### 步骤与观察

1. **安装（add）**
   - `dsh plugin --profile e3 add <repo>` → 退出码 0，`+ @david0702/dsh-cost link:D:/dsh/dsh-cost`。
   - profile manifest 的 `dsh.profile.bundles` **自动新增** `@david0702/dsh-cost`
     —— 证明 `dsh.bundle.patch` 被识别为 bundle 层，用户无需再手写 profile patch。
2. **配置合成（`--dump-config`）**
   - 尾部出现**恰好 1 条**宿主条目：
     ```yaml
     # == @david0702/dsh-cost
     - id: dsh-cost
       name: '@david0702/dsh-cost'
     ```
   - `- id: dsh-cost` 命中 1 次（无重复插入）。
3. **冷启动（`dsh --profile e3 --no-open --port 3099`）**
   - 正常打印授权 URL 并开始监听；带 token 换到会话 cookie 后首页 `200`（27925 字节，含 `__DSH_BOOT__`）。
   - boot 图里出现插件客户端条目 **`"id":"@david0702/dsh-cost"`，且仅 1 行**（未重复注册）。
   - 插件 bundle URL（`/plugins/??…,@david0702/dsh-cost/client.js…`）`200`，
     内含 `"@david0702/dsh-cost/client.css"`，`@deepseek-ai/dsh-cost` 命中 **0 次**（残留已清）。
   - 宿主路由生效：`GET /api/dsh-cost/read?sessionId=__probe_missing__` → `404 {"ok":false,"error":"session not found"}`
     （路由已注册且按设计返回，而非 500）。
4. **卸载（remove）**
   - `dsh plugin --profile e3 remove @david0702/dsh-cost` → 退出码 0；
     `dependencies` 与 `dsh.profile.bundles` 均回到初始两条（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）。

结论：**`0.1.5-rc.1` = `compatible`**（安装 → 合成 → 冷启动 → 客户端条目注册 → 宿主路由 → 卸载全通）。

### 尚未验证的版本

| 官方版本 | 状态 | 说明 |
|---|---|---|
| `0.1.5-alpha.2` | `unknown` | 需各自独立跑一遍一次性 Profile 才能改判 |
| `0.1.5-rc.2` | `unknown` | 同上 |
| 其余 8 个已发布版本 | `unknown` | 同上；只有确认过的旧版本才应升级为 `compatible` |

> 注意：Catalog 对"最新三个官方版本无一 `compatible`"会判 `DSH_LATEST_THREE_COMPATIBILITY_HOLD`。
> 目前已有 `0.1.5-rc.1` 一项实测 `compatible`，满足最低可安装证据；若要把 `alpha.2` / `rc.2` 也标为 `compatible`，
> 按上面同一套步骤各跑一次即可（不要凭"应该也能跑"直接写 `compatible`）。

## 三、本地自检

```bash
npm test          # 槽位时序自检 + 上架契约自检
npm run check:contract
```

`scripts/contract-check.mjs` 覆盖：`dsh.bundle.patch` 可解析且在 `files` 内、`dshReleases` 取值合法且覆盖最新三版本、
`engines.node`、无生命周期脚本、Patch 恰好插入 1 条自有 ID、`name`/包名/`__ModuleLoader__.load` id 三者一致、
无自指 `@deepseek-ai/*`、客户端入口语法可解析。

## 四、边界声明

- 本文件只声明**源码与本地一次性 Profile 证据**；不代表独立安全审计、不代表 Catalog 已收录。
- 自动化检查不会执行本插件的 `install/prepare/build/test` 或运行时代码；相应地，此处也不把未执行的版本写成 `passed`。
