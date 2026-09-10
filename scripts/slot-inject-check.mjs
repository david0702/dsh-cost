// 离线校验：client 半段的槽位注册是否会等待父条目声明 slot。
// 模拟 DSH 0.1.5 的槽位服务语义：register 目标 slot 未声明 -> 抛错；inject 回调在声明提交后才执行。
// 用法：node scripts/slot-inject-check.mjs [client.js 路径]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? resolve(here, "../lib/client.js"));

const noop = () => {};
const reactStub = {
  createElement: () => null,
  Fragment: null,
  useRef: () => ({ current: null }),
  useState: () => [null, noop],
  useEffect: noop,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useSyncExternalStore: () => null,
};

// —— 最小槽位服务（语义对齐 dsh-web-frontend 的 SlotRegistry）——
const declared = new Set();
const declarationListeners = new Set();
const registered = [];
const slots = {
  register(options) {
    if (!declared.has(options.name)) {
      throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
    }
    registered.push(options);
    return noop;
  },
  inject(key, callback) {
    const run = () => {
      if (declared.has(key)) callback();
    };
    declarationListeners.add(run);
    run(); // 已声明则同步执行
    return noop;
  },
};
// 父条目声明槽位（模拟 conversation.composer.bar 的 children 表在 apply 之后才提交）
function declareParentSlot(key) {
  declared.add(key);
  for (const run of [...declarationListeners]) run();
}

let captured = null;
globalThis.window = {
  location: { search: "" },
  __ModuleLoader__: {
    load(entry) {
      captured = entry.factory((name) => {
        if (name === "react") return reactStub;
        throw new Error(`unexpected require(${name})`);
      });
    },
  },
};

new Function(readFileSync(target, "utf8"))();

const errors = [];
const ctx = {
  get: () => undefined,
  effect: (fn) => fn(),
  slots,
};

// 阶段 1：父条目尚未声明 -> apply 不应抛错
captured.apply(ctx);
const afterApply = registered.length;
const threwOnApply = false;

// 阶段 2：父条目声明 -> 应自动完成注册
declareParentSlot("conversation.composer.dock");

const report = {
  target,
  injectDeclared: captured.inject,
  registeredBeforeDeclaration: afterApply,
  registeredAfterDeclaration: registered.length,
  ids: registered.map((r) => `${r.id}#${r.order}@${r.priority ?? 0}`),
};
console.log(JSON.stringify(report, null, 2));

const ok = !threwOnApply && afterApply === 0 && registered.length === 1 && registered[0].id === "cost";
if (!ok) {
  errors.push("注册时机不符合预期");
  console.error("FAIL:", errors.join("; "));
  process.exit(1);
}
console.log("PASS: apply 不再早注册，使用 slots.inject 等父条目声明后注册 1 个条目（id=cost）");
