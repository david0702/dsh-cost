# dsh-cost

DSH（DeepSeek Harness）对话底部的**费用显示插件**。在对话下方的统计行基础上，展示实时累计费用，并把费用按**每笔请求的实际发生时间与当时的模型**分批准确计费，支持高峰 / 空闲 / 历史分时段、模型归属、读图金额与账户余额。

## 功能

- **按笔准确计费**：逐请求按 `发生时间 × 当时模型单价` 累加，而不是拿当前价套全程。
- **分时段计价（三段时间轴）**：
  - 北京时间 **2026-09-10 12:00 之前** —— 归入「历史」，按当时旧价（8-17 前 flat、8-17~9-10 旧峰谷价）计费。
  - **2026-09-10 12:00 起** —— flash 系列降价：空闲时段 输入缓存命中 0.02 / 未命中 1.0 / 输出 4.0 元/M，高峰时段为空闲的 2 倍（0.04 / 2.0 / 8.0）。这一时段再分「高峰 / 低谷」。
  - 高峰 = 工作日 9:00–12:00 / 14:00–18:00（北京时间），其余为空闲。周末一律空闲。
  - 注：V4 Pro 请求后续会路由到 V4.1 Flash 并按 V4.1 Flash 单价计费，本插件在 2026-09-10 12:00 起对其亦按新 flash 价处理。
- **分时段明细卡**（悬停/点开药丸查看）：高峰 / 低谷 / 历史 三档，当前档加粗，底部按金额占比分段小条。
- **官方同款「药丸」外观**：底部那一行沿用 DSH 自带统计行（`dsh-client-ui-chat` 的 StatsPills）的规格，
  图标 14px、`border-radius:24px`、`padding:1px 8px`、`gap:6px`、13px 三级文字色、tabular-nums，
  hover 反色背景。药丸内容为 **费用 · 账户余额 · 当前时段（高峰/低谷/历史）**，与官方统计药丸不重复
  （官方那条给轮次/用时/TPS 与 token 总量/缓存命中率，本插件不再重复这些）。
  参考取值：
  ```css
  /* 官方 packages/client/ui-chat/src/client/chat/StatsPills.module.css（哈希类名已换成 dsh-cost- 前缀） */
  .root{max-width:var(--dsh-chat-content-width);width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;
        font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
        justify-content:center;gap:12px;margin:0 auto;display:flex}
  .pill{border-radius:24px;padding:1px 8px;gap:6px;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);
        font:inherit;font-variant-numeric:tabular-nums;background:0 0;border:none}
  .pill svg{flex:none;width:14px;height:14px}
  button.pill:hover,button.pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
  .sep{color:var(--dsw-alias-separator-primary);margin:0 6px}
  ```
  图标是自绘的 **¥ 硬币**（官方图标集 `ui-primitives` 里没有钱币/费用类图形，只有 gauge、database、clock、api 等），
  按官方同一绘图规格：16 viewBox、纯描边、`strokeWidth 1.25`、`currentColor`、显示尺寸 14px。
  官方自带的统计药丸继续保留，本插件只补一条费用药丸，不重复统计。
- **模型归属**：按模型拆分调用次数与金额，多模型时自动分列。
- **读图金额**：把会话里读图（视觉输入）的 token 单独记账。图片 token 按 DeepSeek 官方规则估算（进模型前自动缩放，单张上限 384 token，按官方计算器实测口径线性拟合，平均误差 ~5%）。
- **账户余额**：药丸中段显示「余额 ¥X」，进会话先拉一次、之后每 5 分钟自动刷新，来源为官方 `GET /user/balance`。
  **点击药丸立即刷新**：同时重取余额与费用明细（跳过 5 分钟定时与 15 秒节流），点击时**硬币图标转一圈**
  （0.7s 线性、`prefers-reduced-motion: reduce` 下自动关闭；每次点击用 React key 重新挂载 svg，保证动画重播），
  刷新中带 `aria-busy="true"` 与 `title="刷新中…"`，明细卡里「余额」行会标注本次刷新时间（如「（02:45:28 刷新）」）。

## 安装

插件分为宿主半（Node 服务端）与客户端半（浏览器）。

1. 把本包放入 DSH profile 的 `node_modules`：

```bash
# 在你的 profile 目录（例如 ~/.dsh/profiles/web/）下
npm install git+https://github.com/david0702/dsh-cost.git
```

> 发布到 npm 后也可用 `npm install @david0702/dsh-cost`（当前尚未发布到 npm，请用上面的 git URL）。

2. 在 profile 的 `cordis.patch.yml` 的 `- insert:` 层加一行：

```yaml
- insert:
    - id: cost
      name: '@david0702/dsh-cost'
```

3. 重启 dsh。客户端改动刷新页面即生效；宿主改动需要重启进程（宿主插件不会热载宿主代码）。

4. 确认插件目录名与客户端 bundle 里的 id 一致（**最容易踩的坑**）：

```bash
# 目录名应当就是 @david0702/dsh-cost
ls ~/.dsh/profiles/web/node_modules/@david0702/dsh-cost/package.json
```

DSH 的 client-modules 按**包名**（即 `node_modules/<pkg>/` 的 `<pkg>`）查找工厂，
而 `lib/client.js` 是自注册脚本 `window.__ModuleLoader__.load({ id: "@david0702/dsh-cost", … })`。
两者不一致时会报：

```
client-modules: bundle … loaded without registering "@david0702/dsh-cost" via __ModuleLoader__.load
failed to import loader entry <hash> (@david0702/dsh-cost): …
```

并且**整页 “Failed to load plugins”**（受影响的是一整批客户端包，不只本插件）。
若你把本包放在别的目录名下（例如放进官方 scope `@deepseek-ai/dsh-cost` 以便与 DSH 自带包同处一个命名空间），
就必须把 `lib/client.js` 第 1 行附近的 `id` 改成同一个名字，`cordis.patch.yml` 里的 `name` 也要一致。

还有一处更隐蔽的坑：client-modules 是按 **`package.json` 的 `name`** 建客户端条目的，
所以 profile 里那份 `package.json` 的 `name` 必须与 `cordis.patch.yml` 里的 `name` 一致。
实测症状：只改 `cordis.patch.yml` 而 profile 副本 `name` 仍是旧名时，插件**静默消失**、
既不报错也不出现在 `__DSH_BOOT__.entries`（总条目数少 1）。排查方式：

```js
// 浏览器控制台
__DSH_BOOT__.entries.map((e) => e.id).filter((id) => /cost/i.test(id))
// 期望输出 ["@david0702/dsh-cost"]；空数组说明条目没进组合
```

## 配置

无必填配置。API Key 走 DSH 的 credentials（`ctx.credentials.resolve("DEEPSEEK_API_KEY")`），用于拉取余额。

## 兼容性

- 依赖 DSH 的具体版本与约定：
  - 客户端使用 `conversation.composer.dock` 槽位、`props.useProjection("tokenUsage")`、`props.useProjection("sessionStats")`、`props.modelDirectories`。
  - 宿主使用 `ctx.webServer.register`、`ctx.credentials.resolve("DEEPSEEK_API_KEY")`、Node 全局 `fetch`。
- **槽位注册必须走 `ctx.slots.inject(slot, cb)`**（DSH 0.1.5+）：
  `conversation.composer.dock` 由 `client-ui-conversation` 的 composer-bar 条目在其 children 表里声明，
  只在该条目挂载期间存在；直接调 `ctx.slots.register` 会抛
  `slot "conversation.composer.dock" is not declared (a parent entry's children table must declare it)`，
  且该异常会顶着宿主 loader 条目名上报（表现为整页 “Failed to load plugins” 的报错块）。
  `slots.inject` 会把注册推迟到声明提交之后，声明消失时自动注销、恢复后重注册。
  离线自检：`npm test`（`scripts/slot-inject-check.mjs`，模拟“先 apply、后声明”的时序）。
- **`lib/client.js` 里 `__ModuleLoader__.load({ id })` 必须与 loader 条目解析出的模块 id 一致**
  （即 profile 里 `node_modules/<pkg>/` 的目录名）。对不上时 client-modules 会报
  `bundle ... loaded without registering "<pkg>"`，且会连累整个初始批次，表现为整页 “Failed to load plugins”。
  本机 profile 装的目录名是 `@deepseek-ai/dsh-cost`，因此文件里写 `@deepseek-ai/dsh-cost`；
  若改从 npm 安装 `@david0702/dsh-cost`，则要同步改回 `@david0702/dsh-cost`。
- 定价与高峰时段常量写死在 `lib/index.js` 的 `RATES` / `PEAK_EPOCH_UTC`，按官方发布更新。
- 实际 token 数以模型接口返回为准；`imageTokensOf` 与卡片金额为 DeepSeek 估算口径（官方说明：估算值，以接口返回为准）。

## License

MIT
