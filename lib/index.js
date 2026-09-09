// dsh-cost host half —— 按每笔请求的时间分批计费。
// 8-17 前 flat 价；8-17 起按北京时间高峰（9-12/14-18）/空闲价。
const name = "dsh-cost";
const inject = ["webServer"];

const RATES = {
  "deepseek-v4-flash": {
    flat: { input: 1, cacheRead: 0.02, output: 2 },
    peak: { input: 3, cacheRead: 0.1, output: 9 },
    offpeak: { input: 1.5, cacheRead: 0.05, output: 4.5 },
  },
  "deepseek-v4-flash-vision-exp": {
    flat: { input: 1, cacheRead: 0.02, output: 2 },
    peak: { input: 3, cacheRead: 0.1, output: 9 },
    offpeak: { input: 1.5, cacheRead: 0.05, output: 4.5 },
  },
  "deepseek-v4-pro": {
    flat: { input: 3, cacheRead: 0.025, output: 6 },
    peak: { input: 9, cacheRead: 0.3, output: 27 },
    offpeak: { input: 4.5, cacheRead: 0.15, output: 13.5 },
  },
};
const DEFAULT_MODEL = "deepseek-v4-flash";
// 旧峰谷价自北京时间 2026-08-17 00:00（UTC 2026-08-16 16:00）起生效
const OLD_PEAK_EPOCH_UTC = Date.UTC(2026, 7, 16, 16, 0, 0);
// 新定价自北京时间 2026-09-10 12:00（UTC 2026-09-10 04:00）起：9-10 12:00 前全归"历史"，之后按新 flash 价分高峰/低谷
const NEW_PRICING_EPOCH_UTC = Date.UTC(2026, 8, 10, 4, 0, 0);
// 9-10 起 flash 系列新价（高峰 = 空闲 × 2）
const NEW_FLASH_OFFPEAK = { input: 1.0, cacheRead: 0.02, output: 4.0 };
const NEW_FLASH_PEAK = { input: 2.0, cacheRead: 0.04, output: 8.0 };
const MODE_META = {
  hist: { label: "历史（9-10 前）" },
  peak: { label: "高峰" },
  offpeak: { label: "低谷" },
};

function beijingPeak(ms) {
  const shifted = new Date(ms + 8 * 3600 * 1000);
  const h = shifted.getUTCHours();
  const day = shifted.getUTCDay();
  if (day === 0 || day === 6) return false; // 周末一律空闲
  return (h >= 9 && h < 12) || (h >= 14 && h < 18);
}

// 展示桶：9-10 12:00 前 = 历史；之后 = 高峰/低谷（新价）
function bucketOfMs(ms) {
  if (ms < NEW_PRICING_EPOCH_UTC) return "hist";
  return beijingPeak(ms) ? "peak" : "offpeak";
}

// 每请求单价：9-10 前按旧价（<8-17 flat，8-17~9-10 旧峰谷）；9-10 起一律新 flash 价（V4 Pro 请求也按新 flash 计费）
function rateAt(model, ms) {
  if (ms >= NEW_PRICING_EPOCH_UTC) {
    return beijingPeak(ms) ? NEW_FLASH_PEAK : NEW_FLASH_OFFPEAK;
  }
  const entry = RATES[model] || RATES[DEFAULT_MODEL];
  if (ms < OLD_PEAK_EPOCH_UTC) return entry.flat;
  return beijingPeak(ms) ? entry.peak : entry.offpeak;
}

function normalizeModel(m) {
  // vision-exp 与 v4-flash 同价，显示与汇总时归并为同一个模型档
  return m === "deepseek-v4-flash-vision-exp" ? "deepseek-v4-flash" : m;
}


function bucketOf(usage) {
  return {
    input: usage.inputTokens || 0,
    output: usage.outputTokens || 0,
    cacheRead: usage.cacheReadTokens || 0,
    cacheWrite: usage.cacheWriteTokens || 0,
  };
}

// 与 token-meter 折叠一致：按 (turn,step) 取最后一次 usage 采样（相邻替换）；
// 同时按 request/header 事件追踪每笔请求当时的模型（模型只在切换时记录）。
function foldUsageEvents(events, defaultModel) {
  const samples = [];
  let lastKey = null;
  let currentModel = defaultModel || DEFAULT_MODEL;
  for (const event of events) {
    if (event.type === "request/header" && event.data && event.data.header && event.data.header.config && typeof event.data.header.config.model === "string" && event.data.header.config.model.length > 0) {
      currentModel = event.data.header.config.model;
      continue;
    }
    let turn, step, usage;
    if (event.type === "assistant/chunk" && event.data && event.data.chunk && event.data.chunk.type === "usage") {
      turn = event.data.turn;
      step = event.data.step;
      usage = event.data.chunk.usage;
    } else if (event.type === "assistant/message" && event.data && event.data.usage !== undefined) {
      turn = event.data.turn;
      step = event.data.step;
      usage = event.data.usage;
    } else {
      continue;
    }
    const key = String(turn) + ":" + String(step);
    const entry = { time: typeof event.time === "number" ? event.time : 0, model: currentModel, buckets: bucketOf(usage) };
    if (key === lastKey) samples[samples.length - 1] = entry;
    else { samples.push(entry); lastKey = key; }
  }
  return samples;
}

// 图片 token 估算：按 DeepSeek 官方规则，图先进模型前会自动缩放（<384^2 放大 / >800^2 缩到约 800×800 面积），单张上限 384 token。
// 缩放后按线性拟合（对官方计算器 13 组实测，平均误差 ~5.3%，优于固定面积/1834）估算 token。
function imageTokensOf(width, height) {
  const MIN = 384 * 384, MAX = 800 * 800;
  let w = Math.max(1, width | 0), h = Math.max(1, height | 0);
  let area = w * h;
  if (area < MIN) { const f = Math.sqrt(MIN / area); w = Math.round(w * f); h = Math.round(h * f); }
  else if (area > MAX) { const f = Math.sqrt(MAX / area); w = Math.round(w * f); h = Math.round(h * f); }
  const tokens = 0.1838 * w + 0.3658 * h - 88.27;
  return Math.min(384, Math.max(1, Math.round(tokens)));
}

// 收集会话里的图片块（递归深扫 events 和 chat.nodes），记录进入时间以便套高峰/空闲价。
function imageBlocksDeep(node, time, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) imageBlocksDeep(n, time, out); return; }
  const type = node.type || node.kind;
  const att = node.attachment;
  if ((type === "image" || type === "image_url" || type === "file") && att && (att.width >= 1 || att.height >= 1)) {
    out.push({ time, w: att.width | 0, h: att.height | 0 });
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (v && typeof v === "object") imageBlocksDeep(v, time, out);
  }
}
function collectImageEvents(events, chatNodes) {
  const imgs = [];
  for (const node of events || []) {
    const time = typeof node.time === "number" ? node.time : 0;
    imageBlocksDeep(node, time, imgs);
  }
  for (const node of chatNodes || []) {
    const time = typeof node.time === "number" ? node.time : 0;
    imageBlocksDeep(node, time, imgs);
  }
  return imgs;
}

function apply(ctx) {
  const webServer = ctx.webServer;
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/dsh-cost/read",
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      try {
        const url = new URL(req.url || "/", "http://x");
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) return send(400, { ok: false, error: "missing sessionId" });
        // 优先内存会话；否则经 sessionQuery 容错读取（含持久化修复）
        let events = null;
        const sessions = ctx.get("sessions");
        const session = sessions && sessions.get(sessionId);
        if (session && Array.isArray(session.events)) events = session.events;
        if (events === null) {
          const query = ctx.get("sessionQuery");
          if (query && typeof query.readSession === "function") {
            try {
              const snap = await query.readSession(sessionId);
              if (snap && Array.isArray(snap.events)) events = snap.events;
            } catch (err) { /* fall through */ }
          }
        }
        if (events === null) {
          const persistence = ctx.get("sessionPersistence");
          if (persistence && typeof persistence.readFrom === "function") {
            try {
              const read = await persistence.readFrom(sessionId, 0);
              if (read && Array.isArray(read.events)) events = read.events;
            } catch (err) { /* fall through */ }
          }
        }
        if (events === null) return send(404, { ok: false, error: "session not found" });
        const samples = foldUsageEvents(events, DEFAULT_MODEL);
        const modes = {};
        for (const key of Object.keys(MODE_META)) modes[key] = { label: MODE_META[key].label, rate: null, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 };
        const modelSummary = {};
        let lastModel = DEFAULT_MODEL;
        let total = 0;
        for (const s of samples) {
          const mode = bucketOfMs(s.time);
          const rate = rateAt(s.model, s.time);
          const cost = ((s.buckets.input + s.buckets.cacheWrite) * rate.input + s.buckets.cacheRead * rate.cacheRead + s.buckets.output * rate.output) / 1e6;
          const m = modes[mode];
          m.rate = { input: rate.input, cacheRead: rate.cacheRead, output: rate.output };
          m.cost += cost;
          m.input += s.buckets.input;
          m.cacheRead += s.buckets.cacheRead;
          m.cacheWrite += s.buckets.cacheWrite;
          m.output += s.buckets.output;
          m.requests += 1;
          const mkey = normalizeModel(s.model);
          const sm = modelSummary[mkey] || (modelSummary[mkey] = { requests: 0, cost: 0 });
          sm.requests += 1;
          sm.cost += cost;
          lastModel = normalizeModel(s.model);
          total += cost;
        }
        const nowMode = bucketOfMs(Date.now());
        // 图片（视觉）token 单独记账
        const imgs = collectImageEvents(events, session && session.chat && session.chat.nodes);
        const imageModes = {};
        for (const key of Object.keys(MODE_META)) imageModes[key] = { label: MODE_META[key].label, tokens: 0, cost: 0, count: 0 };
        let imageTokens = 0, imageCost = 0;
        for (const im of imgs) {
          const mode = bucketOfMs(im.time);
          const rate = rateAt(DEFAULT_MODEL, im.time);
          const toks = imageTokensOf(im.w, im.h);
          const cost = (toks * rate.input) / 1e6;
          imageModes[mode].tokens += toks;
          imageModes[mode].cost += cost;
          imageModes[mode].count += 1;
          imageTokens += toks;
          imageCost += cost;
        }
        send(200, {
          ok: true,
          cost: total,
          symbol: "¥",
          model: lastModel,
          models: modelSummary,
          currentMode: nowMode,
          currentLabel: MODE_META[nowMode].label,
          modes,
          requests: samples.length,
          images: { count: imgs.length, tokens: imageTokens, cost: imageCost, modes: imageModes },
          note: "按每笔请求的时间与模型分批计费（8-17 前现行价，之后高峰/空闲价）",
        });
      } catch (err) {
        send(500, { ok: false, error: String((err && err.message) || err) });
      }
    },
  }), "dsh-cost: accurate cost route");

  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/dsh-cost/balance",
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      try {
        const credentials = ctx.get("credentials");
        if (!credentials || typeof credentials.resolve !== "function") return send(200, { ok: true, balance: null });
        const cred = await credentials.resolve("DEEPSEEK_API_KEY");
        const key = cred && cred.value;
        if (!key) return send(200, { ok: true, balance: null });
        const r = await fetch("https://api.deepseek.com/user/balance", { headers: { "Authorization": "Bearer " + key, "Accept": "application/json" } });
        const j = await r.json();
        const bi = (j && j.balance_infos && j.balance_infos[0]) || null;
        send(200, { ok: true, isAvailable: j && j.is_available, balance: bi ? { currency: bi.currency, total: bi.total_balance, granted: bi.granted_balance, toppedUp: bi.topped_up_balance } : null });
      } catch (err) {
        send(200, { ok: true, balance: null });
      }
    },
  }), "dsh-cost: balance route");
}

export { apply, inject, name };