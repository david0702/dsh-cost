# dsh-cost

DSH（DeepSeek Harness）对话底部的**费用显示插件**。在对话下方的统计行基础上，展示实时累计费用，并把费用按**每笔请求的实际发生时间与当时的模型**分批准确计费，支持高峰 / 空闲 / 历史分时段、模型归属、读图金额与账户余额。

## 功能

- **按笔准确计费**：逐请求按 `发生时间 × 当时模型单价` 累加，而不是拿当前价套全程。
- **分时段计价**：DeepSeek 2026-08-17 起峰谷价。高峰 = 工作日 9:00–12:00 / 14:00–18:00（北京时间），其余为空闲；8-17 前为旧价（flat）。周末一律空闲。
- **分时段明细卡**（悬停查看）：历史 / 高峰 / 空闲 三档，当前档加粗，底部按金额占比分段小条。
- **模型归属**：按模型拆分调用次数与金额，多模型时自动分列。
- **读图金额**：把会话里读图（视觉输入）的 token 单独记账。图片 token 按 DeepSeek 官方规则估算（进模型前自动缩放，单张上限 384 token，按官方计算器实测口径线性拟合，平均误差 ~5%）。
- **账户余额**：卡片顶部「· 余额 ¥X」，5 分钟刷新，来源为官方 `GET /user/balance`。

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

## 配置

无必填配置。API Key 走 DSH 的 credentials（`ctx.credentials.resolve("DEEPSEEK_API_KEY")`），用于拉取余额。

## 兼容性

- 依赖 DSH 的具体版本与约定：
  - 客户端使用 `conversation.composer.dock` 槽位、`props.useProjection("tokenUsage")`、`props.useProjection("sessionStats")`、`props.modelDirectories`。
  - 宿主使用 `ctx.webServer.register`、`ctx.credentials.resolve("DEEPSEEK_API_KEY")`、Node 全局 `fetch`。
- 定价与高峰时段常量写死在 `lib/index.js` 的 `RATES` / `PEAK_EPOCH_UTC`，按官方发布更新。
- 实际 token 数以模型接口返回为准；`imageTokensOf` 与卡片金额为 DeepSeek 估算口径（官方说明：估算值，以接口返回为准）。

## License

MIT
