// 首页：双卡启动台（Codex / Claude）+ 薄型概览状态条 + 网关拓扑卡（本 fork 保留，上游的赞助卡片区已删）。
import {
  ChevronRight,
  Play,
  RotateCcw,
} from "lucide-react";
import { Suspense } from "react";
import { AgentGlyph, useGatewayPayload, useTodayUsage } from "./hub-shared";
import { ClaudeAutoTakeoverRow } from "./ClaudeAutoTakeover";
import { costText, formatTokens, providerEnabled } from "./gateway-model";
import { t, tf } from "@/i18n";
import { CxCard, CxSection, CxStatusIcon } from "./cx-layout";
import type { Actions, AutoTakeoverResult, ToolEntry } from "./app-types";
import { autoTakeoverView, enhancementPlatform, StatusBadge, ToggleVisual } from "./app-shared";
import { lazyNamed } from "./lazy-page";
import { type Route, type ToolId } from "./routes";

// 拓扑卡在网关总览模块里（和网关页共用大量代码），按需加载：首页静态常驻，但不把整块网关代码带进主包。
const HubTopologyCard = lazyNamed(() => import("./HubOverview"), "HubTopologyCard");

/// 首页：整个程序的落脚页。
/// - 顶层：Codex / Claude 双卡启动台（各自整合连接方式摘要与自动接管底栏）
/// - 中层：一行 4 格薄型工作台概览（今日用量 / 本地服务 / 万物皆拓展 / 会话）
/// - 下层：网关拓扑卡（本 fork 保留；上游的赞助卡片区在本 fork 里删掉）
export function HomeScreen({
  actions,
  tools,
  codexRunning,
  launchPending,
  onLaunchCodex,
  onNavigate,
  onOpenAgent,
  autoTakeover,
  autoTakeoverOn,
  watcherEnabled,
}: {
  actions: Actions;
  tools: ToolEntry[];
  codexRunning: boolean;
  launchPending: boolean;
  onLaunchCodex: () => void;
  onNavigate: (route: Route) => void;
  onOpenAgent: (agent: ToolId, destination?: Route) => void;
  autoTakeover: AutoTakeoverResult | null;
  /** 设置还没读到时为 null，开关先禁用。 */
  autoTakeoverOn: boolean | null;
  watcherEnabled: boolean | null;
}) {
  const gateway = useGatewayPayload(10_000);
  const usage = useTodayUsage();
  const connected = new Set((gateway?.agents ?? []).filter((agent) => agent.enabled).map((agent) => agent.agent as string));
  const gatewayInUse = connected.size > 0;
  const pool = gateway?.pool ?? [];

  // Codex 自动接管状态与提示：收进 Codex 卡底栏，异常或未开登录自启时再展开提醒。
  const takeover = autoTakeoverView(autoTakeover);
  const takeoverNeedsLogin = autoTakeoverOn === true && watcherEnabled === false;
  const codexOffTip = enhancementPlatform === "windows"
    ? t("打开后，直接打开 Codex（开始菜单、任务栏）也会自动接管并注入增强，不用再从 Codex # 启动。")
    : t("打开后，直接打开 Codex（Dock、启动台）也会自动接管并注入增强，不用再从 Codex # 启动。");
  const codexWarnTip = t("官方 App 已在运行且没有调试端口时，会先退出再带参数重开（可能中断正在进行的操作）。");
  const codexTakeoverNote = autoTakeoverOn === true && (takeover.status !== "ok" || takeoverNeedsLogin)
    ? [takeover.detail, takeoverNeedsLogin ? t("Codex # 没有设为登录时打开，退出 Codex # 后不会接管。") : ""].filter(Boolean).join(" ")
    : "";

  const codexExclude = new Set(gateway?.gateway.bindings?.codex?.poolExclude ?? []);
  const codexPoolCount = pool.filter((entry) => providerEnabled(entry) && !codexExclude.has(entry.id)).length;

  const claudeCodeAgent = gateway?.agents.find((agent) => agent.agent === "claude");
  const claudeDirectName = claudeCodeAgent?.directPoolProvider
    ? pool.find((entry) => entry.id === claudeCodeAgent.directPoolProvider)?.name ?? null
    : null;
  const claudeDesktopConnected = connected.has("claude-desktop");

  const renderAgentCard = (tool: ToolEntry) => {
    const viaGateway = connected.has(tool.id);

    if (tool.id === "codex") {
      const modeText = viaGateway
        ? (codexPoolCount ? tf("经共享供应商 · {0} 家", [codexPoolCount]) : t("经共享供应商"))
        : tool.activeRelayName
          ? tf("直连 · {0}", [tool.activeRelayName])
          : t("直连");

      return (
        <div className="home-agent-card" key={tool.id}>
          <div className="home-agent-top">
            <div className="home-agent-identity" onClick={() => onOpenAgent(tool.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenAgent(tool.id); } }}>
              <CxStatusIcon tone={codexRunning ? "ok" : "off"}>
                <AgentGlyph agent="codex" className="home-agent-glyph" />
              </CxStatusIcon>
              <div className="home-agent-title-wrap">
                <div className="home-agent-title-row">
                  <strong>{tool.name}</strong>
                  <span className={`home-status-pill${codexRunning ? " is-ok" : ""}`}>
                    <i aria-hidden="true" className="home-status-dot" />
                    {codexRunning ? t("运行中") : t("未运行")}
                  </span>
                </div>
                <span className="home-agent-sub">{t("桌面端增强 · 万物皆拓展")}</span>
              </div>
            </div>
            <button
              className={codexRunning ? "cx-secondary" : "cx-primary"}
              disabled={launchPending}
              onClick={onLaunchCodex}
              type="button"
            >
              {codexRunning ? <RotateCcw /> : <Play />}
              {codexRunning ? t("重启") : t("启动")}
            </button>
          </div>

          <div className="home-agent-links">
            <button className="home-agent-link" onClick={() => onOpenAgent("codex", "relay")} type="button">
              <span className="home-agent-link-k">{t("连接与供应商")}</span>
              <span className="home-agent-link-v">
                <span>{modeText}</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
            <button className="home-agent-link" onClick={() => onOpenAgent("codex", "enhance")} type="button">
              <span className="home-agent-link-k">{t("拓展与增强")}</span>
              <span className="home-agent-link-v">
                <span>{t("桌面增强 · 拓展注入")}</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
          </div>

          <div className="home-takeover-foot">
            <div className="home-takeover-main">
              <div className="home-takeover-title">
                <span>{t("自动接管 Codex")}</span>
                {autoTakeoverOn ? <StatusBadge status={takeover.status} label={takeover.label} /> : null}
                <span className="home-help-tip" title={`${codexOffTip}\n${codexWarnTip}`}>?</span>
              </div>
              <div className="home-takeover-controls">
                <label className="switch-row compact relay-master-switch relay-master-switch-compact home-takeover-switch">
                  <input
                    aria-label={t("开启自动接管")}
                    checked={autoTakeoverOn === true}
                    disabled={autoTakeoverOn === null}
                    onChange={(event) => void actions.setAutoTakeover(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <ToggleVisual />
                </label>
              </div>
            </div>
            {codexTakeoverNote || takeoverNeedsLogin ? (
              <div className="home-takeover-extra">
                {codexTakeoverNote ? <p className="home-takeover-note">{codexTakeoverNote}</p> : null}
                {takeoverNeedsLogin ? (
                  <div className="home-takeover-actions">
                    <button className="cx-secondary" onClick={() => void actions.setWatcherEnabled(true)} type="button">
                      {t("登录时打开 Codex #")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (tool.id === "claude") {
      const claudeConnected = viaGateway || claudeDesktopConnected;
      const codeStatus = viaGateway
        ? t("经本地服务")
        : claudeDirectName
          ? tf("直连 · {0}", [claudeDirectName])
          : t("直连");
      const desktopStatus = claudeDesktopConnected ? t("经本地服务") : t("桌面增强");

      return (
        <div className="home-agent-card" key={tool.id}>
          <div className="home-agent-top">
            <div className="home-agent-identity" onClick={() => onOpenAgent(tool.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenAgent(tool.id); } }}>
              <CxStatusIcon tone={claudeConnected ? "ok" : "off"}>
                <AgentGlyph agent="claude" className="home-agent-glyph" />
              </CxStatusIcon>
              <div className="home-agent-title-wrap">
                <div className="home-agent-title-row">
                  <strong>Claude</strong>
                  <span className={`home-status-pill${claudeConnected ? " is-ok" : ""}`}>
                    <i aria-hidden="true" className="home-status-dot" />
                    {claudeConnected ? t("经本地服务") : t("直连")}
                  </span>
                </div>
                <span className="home-agent-sub">Claude Code · Claude Desktop</span>
              </div>
            </div>
            <button className="cx-secondary" onClick={() => onOpenAgent(tool.id)} type="button">
              {t("进入管理")}
              <ChevronRight aria-hidden="true" />
            </button>
          </div>

          <div className="home-agent-links">
            <button className="home-agent-link" onClick={() => onOpenAgent("claude", "claudeProviders")} type="button">
              <span className="home-agent-link-k">Claude Code</span>
              <span className="home-agent-link-v">
                <span>{codeStatus}</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
            <button className="home-agent-link" onClick={() => onOpenAgent("claude-desktop", "claudeDesktopProviders")} type="button">
              <span className="home-agent-link-k">Claude Desktop</span>
              <span className="home-agent-link-v">
                <span>{desktopStatus}</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
          </div>

          <ClaudeAutoTakeoverRow
            key="claude-auto-takeover"
            loginReminder
            onEnableLogin={() => actions.setWatcherEnabled(true)}
            title={t("自动接管 Claude")}
            variant="card-footer"
          />
        </div>
      );
    }

    return (
      <div className="home-agent-card" key={tool.id}>
        <div className="home-agent-top">
          <div className="home-agent-identity" onClick={() => onOpenAgent(tool.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenAgent(tool.id); } }}>
            <CxStatusIcon tone={viaGateway ? "ok" : "off"}>
              <AgentGlyph agent={tool.id} className="home-agent-glyph" />
            </CxStatusIcon>
            <div className="home-agent-title-wrap">
              <div className="home-agent-title-row">
                <strong>{tool.name}</strong>
                <span className={`home-status-pill${viaGateway ? " is-ok" : ""}`}>
                  <i aria-hidden="true" className="home-status-dot" />
                  {viaGateway ? t("经本地服务") : gatewayInUse ? t("未接入") : t("直连")}
                </span>
              </div>
            </div>
          </div>
          <button className="cx-secondary" onClick={() => onOpenAgent(tool.id)} type="button">
            {t("进入管理")}
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  // 薄型概览条：复用首页已在拉的用量和本地服务状态，不引入额外请求或大模块。
  const todayCalls = usage?.totals.calls ?? 0;
  const todayCost = costText(usage?.costs);
  const todayTokens = usage?.totals ? formatTokens(usage.totals.inputTokens + usage.totals.outputTokens) : "";
  const usageSub = todayCalls > 0
    ? (todayCost || todayTokens)
    : (gatewayInUse ? t("今日暂无调用") : t("经本地服务统计"));

  const serviceRunning = Boolean(gateway?.helperRunning && gatewayInUse);
  const servicePrimary = serviceRunning
    ? tf("端口 {0}", [gateway?.port ?? 0])
    : t("直连模式");
  const serviceSub = serviceRunning
    ? tf("{0} 家供应商 · {1} 个接入", [pool.length, connected.size])
    : pool.length
      ? tf("{0} 家共享供应商", [pool.length])
      : t("按需启用");

  return (
    <div className="tp-page home-page">
      <CxSection title={t("状态")}>
        <div className="home-agent-grid">
          {tools.filter((tool) => tool.id !== "claude-desktop").map(renderAgentCard)}
        </div>
      </CxSection>

      <div className="home-metrics" role="region" aria-label={t("状态")}>
        <button className="home-metric" onClick={() => onNavigate("gatewayUsage")} type="button">
          <span className="home-metric-head">
            <span>{t("今日用量")}</span>
            <ChevronRight aria-hidden="true" />
          </span>
          <span className="home-metric-val">
            <strong>{tf("{0} 次", [todayCalls])}</strong>
            {usageSub ? <small>{usageSub}</small> : null}
          </span>
        </button>

        <button className="home-metric" onClick={() => onNavigate("gateway")} type="button">
          <span className="home-metric-head">
            <span>{t("本地服务")}</span>
            <ChevronRight aria-hidden="true" />
          </span>
          <span className="home-metric-val">
            <i aria-hidden="true" className={`home-status-dot${serviceRunning ? " is-ok" : ""}`} />
            <strong>{servicePrimary}</strong>
            <small>{serviceSub}</small>
          </span>
        </button>

        <button className="home-metric" onClick={() => onNavigate("userScripts")} type="button">
          <span className="home-metric-head">
            <span>{t("万物皆拓展")}</span>
            <ChevronRight aria-hidden="true" />
          </span>
          <span className="home-metric-val">
            <strong>{t("万物皆拓展")}</strong>
            <small>{t("界面、工具与钩子")}</small>
          </span>
        </button>

        <button className="home-metric" onClick={() => onNavigate("sessions")} type="button">
          <span className="home-metric-head">
            <span>{t("会话")}</span>
            <ChevronRight aria-hidden="true" />
          </span>
          <span className="home-metric-val">
            <strong>{t("会话")}</strong>
            <small>{t("继续或回退本地会话")}</small>
          </span>
        </button>
      </div>

      <Suspense fallback={<CxCard className="hub-topology-card hub-topology-home">{null}</CxCard>}>
        <HubTopologyCard
          codex={{ running: codexRunning, providerName: tools.find((tool) => tool.id === "codex")?.activeRelayName ?? null }}
          notify={actions.showMessage}
          onNavigate={(next) => onNavigate(next)}
          onOpenAgent={(agent) => onOpenAgent(agent as ToolId)}
          roomy
        />
      </Suspense>
    </div>
  );
}
