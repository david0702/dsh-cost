window.__ModuleLoader__.load({
  // id 必须等于 profile 里 loader 条目解析出的模块 id，即插件目录名
  // （`node_modules/<pkg>/` 的那个 <pkg>），否则 client-modules 会报
  // `bundle ... loaded without registering "<id>"` 并带崩整个初始批次。
  // 本包名为 @david0702/dsh-cost，无论 npm/git 安装还是本地放置，
  // 目录名都应与之一致；若你把它放在别的目录名下，请同步改这里。
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

    function billedInputTokens(usage) {
      return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
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

    // ---- 底部 dock 行：官方 StatsPills 同款“药丸”格式 ----
    // 官方参考（同槽位、同类目）：@deepseek-ai/dsh-client-ui-chat 的 StatsPills
    //   .bOPqQW_root{max-width:var(--dsh-chat-content-width);width:100%;
    //                padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;
    //                font-size:var(--dsh-content-font-size-secondary,13px);
    //                line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
    //                justify-content:center;gap:12px;margin:0 auto;display:flex}
    //   .bOPqQW_pill{border-radius:24px;padding:1px 8px;gap:6px;display:inline-flex;
    //                align-items:center;color:var(--dsw-alias-label-tertiary);
    //                font-variant-numeric:tabular-nums;background:0 0;border:none}
    //   .bOPqQW_pill svg{width:14px;height:14px;flex:none}
    //   button.bOPqQW_pill:hover{background:var(--dsw-alias-interactive-bg-hover);
    //                            color:var(--dsw-alias-label-secondary)}
    //   .bOPqQW_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}
    //   button 内：官方为 <IconDatabaseOutline16/> + <span class=label>{totalText} · {cacheHitText}</span>；
    //   本插件换成自绘的 ¥ 硬币图标（官方图标集无钱币图形），文字换成 费用 · 余额 · 时段。
    // 本插件按同一规格在 client.css 里复刻（前缀 dsh-cost-）；
    // 药丸内容与官方统计药丸不重复：官方给「轮次/用时/TPS」与「token 总量/缓存命中率」，
    // 本插件给「费用 · 账户余额 · 当前时段（高峰/低谷/历史）」，明细在点开的卡片里。

    // 药丸里的图标：官方 ui-primitives 的图标集里没有费用/钱币类图形
    // （只有 gauge / database / clock / api 等），因此按官方同一绘图规格自绘一个
    // 「¥ 硬币」：16 viewBox、纯描边、strokeWidth 1.25、currentColor、尺寸 14px。
    function iconCoin() {
      return react.createElement("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true
      },
        react.createElement("circle", { cx: 8, cy: 8, r: 6, stroke: "currentColor", strokeWidth: 1.25 }),
        react.createElement("path", { d: "M5.6 5.1L8 8.1L10.4 5.1", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round" }),
        react.createElement("path", { d: "M8 8.1V11", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" }),
        react.createElement("path", { d: "M5.9 8.75H10.1", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" }),
        react.createElement("path", { d: "M5.9 10.15H10.1", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" })
      );
    }

    // 点击刷新时的转圈动画：刷新是一个动作类反馈，按惯例用图标旋转表达。
    // spinKey 每次点击都变，用作 React key 重新挂载 svg -> CSS 动画重头播一遍
    // （否则同一个元素上重复触发同名动画不会重播）。
    function DockIcon(props) {
      return react.createElement("span", {
        key: props.spinKey || 0,
        className: "dsh-cost-icon" + (props.spinning ? " dsh-cost-icon-spin" : "")
      }, iconCoin());
    }

    // 行渲染：justify-content:center 跟随官方（与自带统计行同一视觉中轴）
    function renderDockRow(children) {
      return react.createElement("div", { className: "dsh-cost-root", "data-dsh-cost": "" }, children);
    }

    // 药丸内容：费用 · 余额 · 当前时段（高峰/低谷/历史）。
    // 每段之间用官方同款分隔点（.dsh-cost-sep），缺项自动跳过。
    function DockPill(props) {
      var segs = [];
      if (props.costText) segs.push(props.costText);
      if (props.balanceText) segs.push(props.balanceText);
      if (props.tierText) segs.push(props.tierText);
      var labelChildren = [];
      for (var i = 0; i < segs.length; i++) {
        if (i > 0) labelChildren.push(react.createElement("span", { key: "sep" + i, className: "dsh-cost-sep", "aria-hidden": true }, "·"));
        labelChildren.push(react.createElement("span", { key: "seg" + i }, segs[i]));
      }
      var content = react.createElement("span", { className: "dsh-cost-label" }, labelChildren);
      var ariaText = segs.join(" · ");
      var common = {
        className: "dsh-cost-pill",
        "aria-label": ariaText,
        // 刷新中给个可读反馈（文字不变、不跳布局；图标另转一圈）
        title: props.refreshing ? "刷新中…" : undefined,
        "aria-busy": props.refreshing ? "true" : undefined,
        onMouseEnter: props.onEnter,
        onMouseLeave: props.onLeave,
        onClick: props.onClick
      };
      var icon = react.createElement(DockIcon, { spinning: !!props.refreshing, spinKey: props.spinKey });
      // 有明细可看 -> 用 button（官方可点开面板的药丸也是 button，hover/aria-expanded 样式同款）
      if (props.interactive) {
        return react.createElement("span", { className: "dsh-cost-anchor" },
          react.createElement("button", Object.assign({ type: "button", "aria-haspopup": "dialog", "aria-expanded": !!props.expanded }, common),
            icon, content
          ),
          props.panel
        );
      }
      return react.createElement("span", { className: "dsh-cost-anchor" },
        react.createElement("span", common, icon, content)
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
        props.balance && props.balance.total != null ? react.createElement("div", { className: "dsh-cost-card-balance" },
          "· 余额 ¥" + formatCost(parseFloat(props.balance.total)),
          props.balanceUpdatedText ? react.createElement("span", { className: "dsh-cost-card-balance-time" }, "（" + props.balanceUpdatedText + " 刷新）") : null
        ) : null,
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
      // 明细只跟悬停走：点击不再固定展开（点击只用于立即刷新余额/明细）
      var expanded = hovering;
      var lineRef = react.useRef(null);
      var lastFetchRef = react.useRef(0);
      var balanceState = react.useState(null);
      var balance = balanceState[0];
      var setBalance = balanceState[1];
      var hasUsage = usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0);
      // 手工触发用的稳定引用（不影响自动刷新的节流/定时）
      var manualReadRef = react.useRef(null);
      var manualBalanceRef = react.useRef(null);
      var balanceStampState = react.useState(0);
      var balanceStamp = balanceStampState[0];
      var setBalanceStamp = balanceStampState[1];
      var refreshingState = react.useState(false);
      var refreshing = refreshingState[0];
      var setRefreshing = refreshingState[1];
      // 每次点击自增：作为图标的 React key，让转圈动画每次点击都重头播
      var spinKeyState = react.useState(0);
      var spinKey = spinKeyState[0];
      var setSpinKey = spinKeyState[1];

      react.useEffect(function () {
        if (!hasUsage) { setAccurate(null); return; }
        var cancelled = false;
        manualReadRef.current = function () {
          return window.fetch("/api/dsh-cost/read?sessionId=" + encodeURIComponent(props.sessionId), { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!cancelled) setAccurate(d && d.ok ? d : null); })
            .catch(function () { if (!cancelled) setAccurate(null); });
        };
        var now = Date.now();
        if (now - lastFetchRef.current < 15000) return function () { cancelled = true; };
        lastFetchRef.current = now;
        manualReadRef.current();
        return function () { cancelled = true; manualReadRef.current = null; };
      }, [props.sessionId, hasUsage, usage === undefined ? 0 : usage.uncachedInputTokens, usage === undefined ? 0 : usage.outputTokens, usage === undefined ? 0 : usage.cacheReadTokens, usage === undefined ? 0 : usage.cacheWriteTokens]);

      // 账户余额：进会话先拉一次，之后每 5 分钟自动刷新；点击药丸可立即刷新
      react.useEffect(function () {
        var cancelled = false;
        function load() {
          return window.fetch("/api/dsh-cost/balance", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (cancelled) return;
              setBalance(d && d.balance ? d.balance : null);
              setBalanceStamp(Date.now());
            })
            .catch(function () { if (!cancelled) setBalance(null); });
        }
        manualBalanceRef.current = load;
        load();
        var t = setInterval(load, 5 * 60 * 1000);
        return function () { cancelled = true; clearInterval(t); manualBalanceRef.current = null; };
      }, []);

      // 点击药丸 = 立即刷新（费用明细 + 余额同时重取，跳过 15 秒节流与 5 分钟定时）+ 图标转一圈
      function refreshNow() {
        setSpinKey(spinKey + 1);
        var jobs = [];
        if (manualReadRef.current) jobs.push(manualReadRef.current());
        if (manualBalanceRef.current) jobs.push(manualBalanceRef.current());
        if (jobs.length === 0) return;
        setRefreshing(true);
        Promise.all(jobs).then(function () { setRefreshing(false); }, function () { setRefreshing(false); });
      }

      if (!hasUsage) return null;
      var uncached = usage.uncachedInputTokens;
      var cacheRead = usage.cacheReadTokens;
      var cacheWrite = usage.cacheWriteTokens;
      var output = usage.outputTokens;
      var total = 0;
      if (accurate !== null) {
        // 精确分批计费（Host 按每笔请求的时间与模型）——明细在悬停药丸里的 CostCard 中展示
        total = accurate.cost;
      } else {
        // 回退：本地估算（按当前时刻单价）
        var rate = rateFor(selection && selection.model, new Date());
        var inputCost = bucketCost(uncached + cacheWrite, rate.input);
        var cacheReadCost = bucketCost(cacheRead, rate.cacheRead);
        var outputCost = bucketCost(output, rate.output);
        total = inputCost + cacheReadCost + outputCost;
      }
      // 药丸三段：费用 · 余额 · 当前时段（高峰/低谷/历史）
      var balanceText = balance && balance.total != null ? "余额 ¥" + formatCost(parseFloat(balance.total)) : null;
      var nowMode = priceMode(new Date());
      var tierText = accurate !== null && accurate.currentLabel
        ? accurate.currentLabel
        : (nowMode === "peak" ? "高峰" : nowMode === "offpeak" ? "低谷" : "历史");
      var card = null;
      if (expanded && accurate !== null) {
        // 余额那行附上「上次刷新时间」：点击刷新后能立刻看出确实重取过
        var balanceUpdatedText = balanceStamp > 0 ? new Date(balanceStamp).toLocaleTimeString() : null;
        card = react.createElement(CostCard, {
          accurate: accurate,
          total: total,
          variant: costVariant(),
          balance: balance,
          balanceUpdatedText: balanceUpdatedText
        });
      }
      return react.createElement(
        "div",
        { className: "dsh-cost-wrap", ref: lineRef },
        renderDockRow(react.createElement(DockPill, {
          costText: "¥" + formatCost(total),
          balanceText: balanceText,
          tierText: tierText,
          interactive: accurate !== null,
          expanded: expanded && accurate !== null,
          refreshing: refreshing,
          spinKey: spinKey,
          onEnter: function () { setHovering(true); },
          onLeave: function () { setHovering(false); },
          // 点击：只立即重取费用与余额（跳过 15 秒节流 / 5 分钟定时），不固定展开窗口
          onClick: function () { refreshNow(); },
          panel: card
        }))
      );
    }

    // 药丸规格复刻自官方同槽位组件 StatsPills.module.css（见上方注释里的原始取值），
    // 类名换成自己的前缀，避免依赖官方 CSS Module 的哈希类名。
    var CSS = [
      ".dsh-cost-root{max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;margin:0 auto;display:flex}",
      ".dsh-cost-anchor{min-width:0;display:inline-flex;position:relative}",
      ".dsh-cost-pill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
      ".dsh-cost-pill svg{flex:none;width:14px;height:14px}",
      ".dsh-cost-icon{flex:none;display:inline-grid;place-items:center;width:14px;height:14px}",
      "@keyframes dsh-cost-spin{to{transform:rotate(360deg)}}",
      ".dsh-cost-icon-spin{animation:dsh-cost-spin .7s linear}",
      "@media (prefers-reduced-motion: reduce){.dsh-cost-icon-spin{animation:none}}",
      "button.dsh-cost-pill{cursor:pointer}",
      "button.dsh-cost-pill:hover,button.dsh-cost-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dsh-cost-label{text-overflow:ellipsis;min-width:0;overflow:hidden}",
      ".dsh-cost-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}",

      ".dsh-cost-wrap{position:relative;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;margin:0 auto}",
      ".dsh-cost-card{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:100;box-sizing:border-box;width:280px;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);border-radius:12px;padding:12px 14px;font-size:12px;line-height:20px;text-align:left;cursor:default;white-space:normal;font-variant-numeric:tabular-nums}",
      ".dsh-cost-card-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:9px}",
      ".dsh-cost-card-balance{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right;margin:-4px 0 7px}",
      ".dsh-cost-card-balance-time{opacity:.75}",
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

    // DSH 0.1.5 起，槽位注册必须在“父条目已声明该槽位”之后进行：
    // conversation.composer.dock 由 client-ui-conversation 的 composer-bar 条目声明，
    // 直接调用 ctx.slots.register 会抛 `slot "conversation.composer.dock" is not declared`。
    // ctx.slots.inject(slot, cb) 把注册推迟到声明提交之后（声明消失时自动注销、恢复后重注册），
    // 这也是官方客户端插件的写法（client-ui-chat 的 StatsPills 即用 ctx.slots.inject）。
    function injectDock(ctx, options, factory) {
      return ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(options, factory);
      });
    }

    function apply(ctx) {
      ensureCss();
      var modelDirectories = ctx.get("modelDirectories");
      // 单条目：官方自身统计行（client-ui-chat 的 "stats" 药丸）继续显示轮次/用时，
      // 本插件只补一条同款药丸（费用 + token 总量 + 缓存命中率），不再重复统计。
      ctx.effect(function () {
        injectDock(ctx,
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
