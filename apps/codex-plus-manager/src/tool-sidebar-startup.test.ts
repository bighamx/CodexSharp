import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("启动流程不再拉广告源，工具列表照常加载", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("    void refreshTools(true);"));
  const startup = effect.slice(0, effect.indexOf("  }, []);"));
  const events: string[] = [];
  const noOp = async () => {};
  // 首页推荐位移除后启动流程不该再请求广告源；依赖表里也就不再提供 refreshAds。
  assert.doesNotMatch(startup, /refreshAds/, "启动流程不应再请求广告源");
  const dependencies = {
    refreshTools: async () => { events.push("tools"); },
    run: async (task: () => Promise<unknown>) => await task(),
    call: async () => ({ showUpdate: false }),
    consumePendingManagerNavigation: async () => false,
    setRoute: noOp,
    checkUpdate: noOp,
    refreshOverview: noOp,
    refreshSettings: noOp,
    refreshRelay: noOp,
    refreshEnvConflicts: noOp,
    refreshProviderSyncTargets: noOp,
    refreshPendingProviderImport: noOp,
    refreshPendingDreamSkinCommunity: noOp,
    releaseMainWindowWhenHidden: () => {},
  };
  // 仅去掉 TS 泛型，让实际启动 effect 在受控异步依赖中运行；引用了未提供的依赖会直接抛 ReferenceError。
  new Function(...Object.keys(dependencies), startup.replace(/call<StartupResult>/g, "call"))(
    ...Object.values(dependencies),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes("tools"), "工具列表应在启动时加载");
});
