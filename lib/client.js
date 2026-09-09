window.__ModuleLoader__.load({
  id: "@david0702/dsh-cost",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");

    // ---- 定价表（人民币，每百万 tokens；DeepSeek 官网价）----
    // flat: 2026-08-17 前现行价; peak/offpeak: 2026-08-17 起峰谷价（高峰 9-12/14-18 北京时间）。
    var RATES = {
      "deepseek-v4-flash": {
        flat: { input: 1, cacheRead: 0.02, output: 2 },
        peak: { input: 3, cacheRead: 0.1, output: 9 },
        offpeak: { input: 1.5, cacheRead: 0.05, output: 4.5 }
      },
      "deepseek-v4-flash-vision-exp": {
        flat: { input: 1, cacheRead: 0.02, output: 2 },
        peak: { input: 3, cacheRead: 0.1, output: 9 },
        offpeak: { input: 1.5, cacheRead: 0.05, output: 4.5 }
      },
      "deepseek-v4-pro": {
        flat: { input: 3, cacheRead: 0.025, output: 6 },
        peak: { input: 9, cacheRead: 0.3, output: 27 },
        offpeak: { input: 4.5, cacheRead: 0.15, output: 13.5 }
      }
    };
    var DEFAULT_RATE = RATES["deepseek-v4-flash"].flat;
    var PEAK_EPOCH_UTC = Date.UTC(2026, 7, 16, 16, 0, 0);
    var NEW_PRICING_EPOCH_UTC = Date.UTC(2026, 8, 10, 4, 0, 0); // 9-10 12:00 北京时
    var NEW_FLASH_OFFPEAK = { input: 1.0, cacheRead: 0.02, output: 4.0 };
    var NEW_FLASH_PEAK = { input: 2.0, cacheRead: 0.04, output: 8.0 };

    function beijingPeak(now) {
      var shifted = new Date(now.getTime() + 8 * 3600 * 1000);
      var h = shifted.getUTCHours();
      var day = shifted.getUTCDay();
      if (day === 0 || day === 6) return false; // 周末一律空闲
      return (h >= 9 && h < 12) || (h >= 14 && h < 18);
    }

    function priceMode(now) {
      if (now.getTime() < NEW_PRICING_EPOCH_UTC) {
        if (now.getTime() < PEAK_EPOCH_UTC) return "flat";
        return beijingPeak(now) ? "peak" : "offpeak";
      }
      return beijingPeak(now) ? "peak" : "offpeak";
    }

    function rateFor(model, now) {
      if (now.getTime() >= NEW_PRICING_EPOCH_UTC) {
        return beijingPeak(now) ? NEW_FLASH_PEAK : NEW_FLASH_OFFPEAK;
      }
      var entry = (model && RATES[model]) || RATES["deepseek-v4-flash"];
      var mode = priceMode(now);
      return mode === "flat" ? entry.flat : mode === "peak" ? entry.peak : entry.offpeak;
    }

    function formatTokens(n) {
      var scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
      if (n < 1e3) return String(n);
      if (n < 1e6) return scaled(n / 1e3) + "K";
      return scaled(n / 1e6) + "M";
    }

    function formatExact(n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function formatDuration(ms) {
      var s = ms / 1e3;
      if (s < 60) return String(Math.round(s * 10) / 10) + "s";
      var whole = Math.round(s);
      return Math.floor(whole / 60) + "m" + (whole % 60) + "s";
    }

    function formatTokensPerSecond(tps) {
      var clamped = Math.max(0, tps);
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
    }

    function billedInputTokens(usage) {
      return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    }

    function cacheHitPercent(usage) {
      var denominator = billedInputTokens(usage);
      return denominator === 0 ? null : Math.round((usage.cacheReadTokens / denominator) * 100);
    }

    function assistantStepReading(node) {
      var timing = node.timing;
      return {
        ttftMs: timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
        decodeMs: timing !== undefined && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
        outputTokens: typeof node.usage === "object" && node.usage !== null && typeof node.usage.outputTokens === "number" && Number.isFinite(node.usage.outputTokens) && node.usage.outputTokens >= 0 ? node.usage.outputTokens : null
      };
    }

    function deriveStats(nodes) {
      var turns = new Set();
      var steps = 0, llmMs = 0, toolMs = 0, ttftMs = 0, ttftSteps = 0, decodeMs = 0, decodeTokens = 0;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.kind === "tool-result") {
          if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
          continue;
        }
        if (node.kind !== "assistant") continue;
        turns.add(node.turn);
        steps += 1;
        if (node.timing !== undefined && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
        var reading = assistantStepReading(node);
        if (reading.ttftMs !== null) { ttftMs += reading.ttftMs; ttftSteps += 1; }
        if (reading.decodeMs !== null && reading.outputTokens !== null) { decodeMs += reading.decodeMs; decodeTokens += reading.outputTokens; }
      }
      return { turns: turns.size, steps: steps, llmMs: llmMs, toolMs: toolMs, ttftMs: ttftMs, ttftSteps: ttftSteps, decodeMs: decodeMs, decodeTokens: decodeTokens };
    }

    function formatCost(cost) {
      if (cost < 0.01) return String(Math.round(cost * 1e4) / 1e4);
      if (cost < 1) return String(Math.round(cost * 1e3) / 1e3);
      return String(Math.round(cost * 100) / 100);
    }

    function shortModel(m) {
      return ("string" === typeof m ? m : "deepseek-v4-flash").replace(/^deepseek-/, "");
    }

    function bucketCost(tokens, rate) {
      return (tokens * rate) / 1e6;
    }

    // 订阅会话模型目录（尽力而为；未加载时返回 null，走默认费率）
    function useCurrentModel(modelDirectories, sessionId) {
      return react.useSyncExternalStore(
        react.useCallback(function (cb) {
          if (!modelDirectories) return function () {};
          var store;
          try { store = modelDirectories.directoryFor(sessionId).store; } catch (e) { return function () {}; }
          if (!store || typeof store.subscribe !== "function") return function () {};
          return store.subscribe(cb);
        }, [modelDirectories, sessionId]),
        react.useCallback(function () {
          if (!modelDirectories) return null;
          try {
            var store = modelDirectories.directoryFor(sessionId).store;
            var snap = typeof store.getSnapshot === "function" ? store.getSnapshot() : null;
            return snap && snap.current ? snap.current : null;
          } catch (e) { return null; }
        }, [modelDirectories, sessionId])
      );
    }

    // ---- 第一行：统计（无输入/输出）----
    function StatsLineLite(props) {
      var settledNodes = props.useSession(function (s) { return s.chat.legacy.nodes; });
      var usage = props.useProjection("tokenUsage");
      var projected = props.useProjection("sessionStats");
      var stats = react.useMemo(function () { return projected || deriveStats(settledNodes); }, [projected, settledNodes]);
      var groups = [];
      if (stats.steps > 0) {
        groups.push(props.t("stats.counts", { turns: stats.turns, steps: stats.steps }));
        var durations = [];
        if (stats.llmMs > 0) durations.push(props.t("stats.llm", { duration: formatDuration(stats.llmMs) }));
        if (stats.toolMs > 0) durations.push(props.t("stats.toolCall", { duration: formatDuration(stats.toolMs) }));
        if (durations.length > 0) groups.push(durations.join(" · "));
        var speeds = [];
        if (stats.ttftSteps > 0) speeds.push(props.t("stats.ttftAverage", { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }));
        if (stats.decodeMs > 0) speeds.push(props.t("stats.tokensPerSecond", { throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }));
        if (speeds.length > 0) groups.push(speeds.join(" · "));
      }
      if (usage !== undefined) {
        var cacheHit = cacheHitPercent(usage);
        if (cacheHit !== null) groups.push(props.t("stats.cacheHit", { percent: cacheHit }));
      }
      if (groups.length === 0) return null;
      var line = groups.join(" | ");
      return react.createElement(
        "div",
        { className: "dsh-cost-stats", title: line },
        groups.map(function (group, i) {
          return react.createElement("span", { key: i },
            i > 0 ? react.createElement(react.Fragment, null, react.createElement("span", { className: "dsh-cost-sep", "aria-hidden": true }, "|"), " ") : null,
            group
          );
        })
      );
    }

    // 卡片视觉变体：?costVariant=a|b|c（默认 a=定稿版）
    function costVariant() {
      try { return (new URLSearchParams(window.location.search).get("costVariant") || "a").toLowerCase(); }
      catch (e) { return "a"; }
    }

    // ---- 悬停卡片：分时段费用明细（重构版：总额放大 + 当前档成行 + 历史弱化）----
    function CostCard(props) {
      var a = props.accurate;
      var variant = props.variant || "base";
      var order = ["peak", "offpeak", "hist"];
      var meta = {
        hist: { label: "历史（9-10 前）", color: "var(--dsw-static-neutral-bluish-400)", muted: true },
        peak: { label: "高峰", color: "var(--dsw-alias-state-warn-primary)" },
        offpeak: { label: "低谷", color: "var(--dsw-alias-state-success-primary)" }
      };
      var rows2 = [];
      var maxC = Math.max(0.0001, props.total);
      for (var i = 0; i < order.length; i++) {
        var m = a.modes[order[i]];
        if (!m || m.requests === 0) continue;
        var mt = meta[order[i]];
        rows2.push({
          key: order[i], color: mt.color, label: mt.label, muted: !!mt.muted, current: a.currentMode === order[i],
          requests: m.requests, cost: m.cost, pct: Math.max(2, Math.round(m.cost / maxC * 100))
        });
      }
      var modelKeys = Object.keys(a.models || {});
      var modelTitle = modelKeys.length > 1 ? "多模型" : (a.model || "deepseek-v4-flash");
      // 底部小条分段顺序：历史 → 高峰 → 空闲（左到右，时间早→晚）
      var barOrder = ["hist", "peak", "offpeak"];
      var barSegs = [];
      for (var bi = 0; bi < barOrder.length; bi++) {
        var bk = barOrder[bi];
        var bm = a.modes[bk];
        if (!bm || bm.requests === 0) continue;
        barSegs.push({ key: bk, color: meta[bk].color, pct: Math.max(2, Math.round(bm.cost / maxC * 100)) });
      }

      function tierRow(r) {
        if (variant === "c") {
          var cRow = "dsh-cost-card-row"; if (r.current) cRow += " dsh-cost-card-row-current";
          return react.createElement("div", { key: r.key, className: cRow },
            react.createElement("span", { className: "dsh-cost-card-label" }, r.label),
            react.createElement("span", { className: "dsh-cost-card-mbar" },
              react.createElement("span", { className: "dsh-cost-card-mbar-fill", style: { width: r.pct + "%", background: r.color } })
            ),
            react.createElement("span", { className: "dsh-cost-card-amt" }, "¥" + formatCost(r.cost))
          );
        }
        var isA = variant === "a";
        var rowCls = "dsh-cost-card-row";
        if (r.current) rowCls += " dsh-cost-card-row-current";
        else if (r.muted) rowCls += " dsh-cost-card-hist";
        if (isA) rowCls += " dsh-cost-card-row-a";
        var dotCls = "dsh-cost-dot" + (isA ? " dsh-cost-dot-a" : "");
        var dotBg = r.color;
        if (variant === "b" && !r.current) dotBg = "var(--dsw-alias-label-tertiary)";
        var labelCls = "dsh-cost-card-label" + (r.current && isA ? " dsh-cost-card-label-cur" : "");
        var amtCls = "dsh-cost-card-amt" + (r.current && variant === "b" ? " dsh-cost-card-amt-cur" : "");
        // A 版：当前档用「加粗档名」表达；圆点统一小尺寸；金额不加粗、不加大
        var tintBg = (r.current && !isA) ? { background: "color-mix(in srgb, " + r.color + " 14%, transparent)" } : null;
        return react.createElement("div", { key: r.key, className: rowCls, style: tintBg },
          react.createElement("span", { className: dotCls, style: { background: dotBg } }),
          react.createElement("span", { className: labelCls }, r.label),
          react.createElement("span", { className: "dsh-cost-card-req" }, r.requests + " 次"),
          react.createElement("span", { className: amtCls }, "¥" + formatCost(r.cost))
        );
      }

      var modelList = Object.keys(a.models || {}).map(function (mk) {
        var mm = a.models[mk];
        return { name: shortModel(mk), requests: mm.requests, cost: mm.cost };
      }).sort(function (x, y) { return y.cost - x.cost; });
      var maxModelCost = modelList.length ? Math.max(0.0001, modelList[0].cost) : 1;
      return react.createElement("div", { className: "dsh-cost-card" + (variant !== "base" ? " dsh-cost-card-v" + variant : "") },
        react.createElement("div", { className: "dsh-cost-card-top" },
          react.createElement("span", { className: "dsh-cost-card-title" }, "会话费用 · " + modelTitle),
          react.createElement("span", { className: "dsh-cost-card-total" }, "¥" + formatCost(props.total))
        ),
        props.balance && props.balance.total != null ? react.createElement("div", { className: "dsh-cost-card-balance" }, "· 余额 ¥" + formatCost(parseFloat(props.balance.total))) : null,
        react.createElement("div", { className: "dsh-cost-card-rows" },
          rows2.map(tierRow)
        ),
        variant === "c" ? null : react.createElement("div", { className: "dsh-cost-card-bar" },
          barSegs.map(function (r) {
            return react.createElement("span", { key: r.key, className: "dsh-cost-card-bar-seg", style: { background: r.color, width: r.pct + "%" } });
          })
        ),
        variant === "a" ? react.createElement("div", { className: "dsh-cost-card-msec" },
          react.createElement("div", { className: "dsh-cost-card-mhead" }, "模型"),
          modelList.map(function (mm) {
            return react.createElement("div", { key: mm.name, className: "dsh-cost-card-mrow" },
              react.createElement("span", { className: "dsh-cost-card-mname" }, mm.name),
              react.createElement("span", { className: "dsh-cost-card-mbar" },
                react.createElement("span", { className: "dsh-cost-card-mbar-fill", style: { width: Math.max(2, Math.round(mm.cost / maxModelCost * 100)) + "%", background: "var(--dsw-alias-state-info-primary)" } })
              ),
              react.createElement("span", { className: "dsh-cost-card-mreq" }, mm.requests + "次"),
              react.createElement("span", { className: "dsh-cost-card-mamt" }, "¥" + formatCost(mm.cost))
            );
          })
        ) : null,
        variant === "a" && a.images && a.images.count > 0 ? react.createElement("div", { className: "dsh-cost-card-imgrow" },
          react.createElement("span", { className: "dsh-cost-card-imgreq" }, "读图"),
          react.createElement("span", { className: "dsh-cost-card-imgnums" }, a.images.count + " 张 · " + formatTokens(a.images.tokens) + " tokens"),
          react.createElement("span", { className: "dsh-cost-card-amt" }, "¥" + formatCost(a.images.cost))
        ) : null,
        variant === "a" ? react.createElement("div", { className: "dsh-cost-card-foot" }, "工作日 9-12 / 14-18 为高峰时段") : null
      );
    }

    // ---- 第二行：未命中输入 / 缓存命中 / 输出 + 费用（优先精确分批计费，回退本地估算）----
    function CostLine(props) {
      var usage = props.useProjection("tokenUsage");
      var selection = useCurrentModel(props.modelDirectories, props.sessionId);
      var state = react.useState(null);
      var accurate = state[0];
      var setAccurate = state[1];
      var hoverState = react.useState(false);
      var hovering = hoverState[0];
      var setHovering = hoverState[1];
      var lineRef = react.useRef(null);
      var lastFetchRef = react.useRef(0);
      var hasUsage = usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0);
      react.useEffect(function () {
        if (!hasUsage) { setAccurate(null); return; }
        var now = Date.now();
        if (now - lastFetchRef.current < 15000) return;
        lastFetchRef.current = now;
        var cancelled = false;
        window.fetch("/api/dsh-cost/read?sessionId=" + encodeURIComponent(props.sessionId), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!cancelled) setAccurate(d && d.ok ? d : null); })
          .catch(function () { if (!cancelled) setAccurate(null); });
        return function () { cancelled = true; };
      }, [props.sessionId, hasUsage, usage === undefined ? 0 : usage.uncachedInputTokens, usage === undefined ? 0 : usage.outputTokens, usage === undefined ? 0 : usage.cacheReadTokens, usage === undefined ? 0 : usage.cacheWriteTokens]);
      // 账户余额（5 分钟刷新）
      var balanceState = react.useState(null);
      var balance = balanceState[0];
      var setBalance = balanceState[1];
      react.useEffect(function () {
        var cancelled = false;
        function load() {
          window.fetch("/api/dsh-cost/balance", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!cancelled) setBalance(d && d.balance ? d.balance : null); })
            .catch(function () { if (!cancelled) setBalance(null); });
        }
        load();
        var t = setInterval(load, 5 * 60 * 1000);
        return function () { cancelled = true; clearInterval(t); };
      }, []);
      if (!hasUsage) return null;
      var uncached = usage.uncachedInputTokens;
      var cacheRead = usage.cacheReadTokens;
      var cacheWrite = usage.cacheWriteTokens;
      var output = usage.outputTokens;
      var parts = [
        "输入 " + formatTokens(uncached),
        "缓存命中 " + formatTokens(cacheRead),
        "输出 " + formatTokens(output)
      ];
      var rows = [];
      var total = 0;
      var modeLabel = "估算";
      if (accurate !== null) {
        // 精确分批计费（Host 按每笔请求的时间与模型）
        total = accurate.cost;
        modeLabel = accurate.currentLabel || "当前价";
        var order = ["peak", "offpeak", "hist"];
        rows.push("费用（按每笔请求时间与模型分批计费 · 模型 " + (accurate.model || "deepseek-v4-flash") + "）");
        var modelKeys = Object.keys(accurate.models || {});
        if (modelKeys.length > 1) {
          rows.push("模型: " + modelKeys.map(function (mk) {
            var mm = accurate.models[mk];
            return mk + "（" + mm.requests + "次 = ¥" + formatCost(mm.cost) + "）";
          }).join(" / "));
        }
        for (var i = 0; i < order.length; i++) {
          var m = accurate.modes[order[i]];
          if (!m || m.requests === 0) continue;
          var rateText = m.rate ? "费率 输入¥" + m.rate.input + "/缓存¥" + m.rate.cacheRead + "/输出¥" + m.rate.output + "/M" : "";
          rows.push(m.label + "（" + m.requests + " 次请求 · " + rateText + "）");
          rows.push("  输入 " + formatExact(m.input) + " · 缓存命中 " + formatExact(m.cacheRead) + " · 输出 " + formatExact(m.output) + " = ¥" + m.cost.toFixed(4));
        }
        rows.push("合计 ¥" + formatCost(total) + "（当前: " + modeLabel + "）");
        rows.push("每笔请求按实际发生时间与当时的模型计费");
      } else {
        // 回退：本地估算（按当前时刻单价）
        var rate = rateFor(selection && selection.model, new Date());
        var modelLabel = selection && RATES[selection.model] ? selection.model : "deepseek-v4-flash（默认）";
        var inputCost = bucketCost(uncached + cacheWrite, rate.input);
        var cacheReadCost = bucketCost(cacheRead, rate.cacheRead);
        var outputCost = bucketCost(output, rate.output);
        total = inputCost + cacheReadCost + outputCost;
        modeLabel = priceMode(new Date()) === "flat" ? "现行价" : (priceMode(new Date()) === "peak" ? "高峰价" : "空闲价");
        rows = [
          "费用（按当前单价估算 · 模型 " + modelLabel + " · " + modeLabel + "）",
          "输入（未命中，含缓存写入） " + formatExact(uncached) + " × ¥" + rate.input + "/M = ¥" + inputCost.toFixed(4),
          "缓存命中 " + formatExact(cacheRead) + " × ¥" + rate.cacheRead + "/M = ¥" + cacheReadCost.toFixed(4),
          "输出 " + formatExact(output) + " × ¥" + rate.output + "/M = ¥" + outputCost.toFixed(4),
          "合计 ¥" + formatCost(total) + "（按当前单价估算）",
        ];
        if (cacheWrite > 0) rows.splice(2, 0, "缓存写入 " + formatExact(cacheWrite) + " × ¥" + rate.input + "/M = ¥" + bucketCost(cacheWrite, rate.input).toFixed(4));
      }
      parts.push("费用 ¥" + formatCost(total));
      var card = null;
      if (hovering && accurate !== null) {
        card = react.createElement(CostCard, { accurate: accurate, total: total, variant: costVariant(), balance: balance });
      }
      return react.createElement(
        "div",
        { className: "dsh-cost-wrap", ref: lineRef, onMouseEnter: function () { setHovering(true); }, onMouseLeave: function () { setHovering(false); } },
        react.createElement(
          "div",
          { className: "dsh-cost-line", title: accurate !== null ? "" : rows.join("\n") },
          parts.map(function (part, i) {
            return react.createElement("span", { key: i },
              i > 0 ? react.createElement(react.Fragment, null, react.createElement("span", { className: "dsh-cost-sep", "aria-hidden": true }, "|"), " ") : null,
              part
            );
          })
        ),
        card
      );
    }

    var CSS = [
      ".dsh-cost-stats{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;margin:0 auto;font-size:12px;line-height:20px;display:block;overflow:hidden}",
      ".dsh-cost-sep{color:var(--dsw-alias-separator-primary);margin:0 10px}",
      ".dsh-cost-wrap{position:relative;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;margin:0 auto}",
      ".dsh-cost-line{text-align:center;box-sizing:border-box;width:100%;padding:0 calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:20px;display:block;overflow:hidden;cursor:help}",
      ".dsh-cost-card{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:100;box-sizing:border-box;width:280px;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);border-radius:12px;padding:12px 14px;font-size:12px;line-height:20px;text-align:left;cursor:default;white-space:normal;font-variant-numeric:tabular-nums}",
      ".dsh-cost-card-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:9px}",
      ".dsh-cost-card-balance{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right;margin:-4px 0 7px}",
      ".dsh-cost-card-title{color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-cost-card-total{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",

      ".dsh-cost-card-row{display:flex;align-items:center;gap:8px;padding:3px 0}",
      ".dsh-cost-card-row-current{border-radius:6px;padding:3px 8px;margin:0 -8px}",
      ".dsh-cost-card-models{display:flex;flex-wrap:wrap;gap:4px 12px;margin:-3px 0 7px;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dsh-cost-card-model{white-space:nowrap}",
      ".dsh-cost-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;margin:0}",
      ".dsh-cost-card-label{flex:1;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-cost-card-hist{display:flex;align-items:center;gap:8px;padding:5px 0 0;margin-top:5px;border-top:1px solid var(--dsw-alias-border-l1);opacity:.62}",
      ".dsh-cost-card-req{color:var(--dsw-alias-label-tertiary);min-width:50px;text-align:right}",
      ".dsh-cost-card-amt{font-weight:500;color:var(--dsw-alias-label-primary);min-width:56px;text-align:right}",
      ".dsh-cost-card-bar{display:flex;height:4px;border-radius:99px;overflow:hidden;margin:12px 0 0;background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-cost-card-bar-seg{height:100%;flex:none;min-width:4px}",
      ".dsh-cost-card-foot{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-align:center;margin-top:8px}",
      ".dsh-cost-card-msec{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}",
      ".dsh-cost-card-mhead{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-bottom:3px;font-weight:600}",
      ".dsh-cost-card-mrow{display:flex;align-items:center;gap:8px;padding:2px 0}",
      ".dsh-cost-card-mname{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}",
      ".dsh-cost-card-mrow .dsh-cost-card-mbar{flex:none;width:56px;height:6px;border-radius:99px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}",
      ".dsh-cost-card-mrow .dsh-cost-card-mbar-fill{display:block;height:100%;border-radius:99px;min-width:2px}",
      ".dsh-cost-card-mreq{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:44px;text-align:right}",
      ".dsh-cost-card-mamt{font-weight:600;color:var(--dsw-alias-label-primary);min-width:56px;text-align:right}",
      ".dsh-cost-card-imgrow{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:11px}",
      ".dsh-cost-card-imgreq{color:var(--dsw-alias-label-tertiary);font-weight:600}",
      ".dsh-cost-card-imgnums{color:var(--dsw-alias-label-secondary)}",
      ".dsh-cost-card-imgrow .dsh-cost-card-amt{margin-left:auto}",
      ".dsh-cost-card-amt-cur{font-weight:700}",
      ".dsh-cost-card-va .dsh-cost-card-title{font-size:11px;font-weight:500}",
      ".dsh-cost-card-va .dsh-cost-card-total{font-size:16px;font-weight:700}",
      ".dsh-cost-card-va .dsh-cost-card-label{font-weight:400}",
      ".dsh-cost-card-va .dsh-cost-card-label-cur{font-weight:700}",
      ".dsh-cost-card-va .dsh-cost-card-req{font-size:11px;font-weight:400}",
      ".dsh-cost-card-va .dsh-cost-card-amt{font-weight:600}",
      ".dsh-cost-dot-a{width:5px;height:5px;opacity:.85}",
      ".dsh-cost-card-mbar{flex:1;height:6px;border-radius:99px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}",
      ".dsh-cost-card-mbar-fill{display:block;height:100%;border-radius:99px;min-width:2px}"
    ].join("");

    var TAG = "@deepseek-ai/dsh-cost/client.css";
    function ensureCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]")) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "@deepseek-ai/dsh-cost";
      tag.dataset.pluginCss = TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function apply(ctx) {
      ensureCss();
      var modelDirectories = ctx.get("modelDirectories");
      ctx.effect(function () {
        return ctx.slots.register(
          { name: "conversation.composer.dock", id: "stats", order: 0, priority: -1, locale: "conversation" },
          function (props) { return react.createElement(StatsLineLite, props); }
        );
      }, "dsh-cost: stats entry");
      ctx.effect(function () {
        return ctx.slots.register(
          { name: "conversation.composer.dock", id: "cost", order: 1, locale: "conversation" },
          function (props) { return react.createElement(CostLine, Object.assign({}, props, { modelDirectories: modelDirectories })); }
        );
      }, "dsh-cost: cost entry");
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
