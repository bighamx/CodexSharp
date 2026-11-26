// 首页。
import {
  Blocks,
  Cable,
  ChevronRight,
  Play,
  Network,
  RotateCcw,
  Settings,
  Waypoints,
  Plug,
  BarChart3,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { AgentGlyph, useGatewayPayload, useTodayUsage } from "./hub-shared";
import { Suspense } from "react";
import { lazyNamed } from "./lazy-page";
import { ClaudeAutoTakeoverRow } from "./ClaudeAutoTakeover";
import { t, tf } from "@/i18n";
import { CxCard, CxRow, CxSection, CxStatusIcon } from "./cx-layout";
import type { Actions, AutoTakeoverResult, ToolEntry } from "./app-types";
import { autoTakeoverView, enhancementPlatform, StatusBadge, ToggleVisual } from "./app-shared";
import { type Route, type ToolId } from "./routes";

// 拓扑卡在网关总览模块里（和网关页共用大量代码），按需加载：首页静态常驻，但不把整块网关代码带进主包。
const HubTopologyCard = lazyNamed(() => import("./HubOverview"), "HubTopologyCard");

/// 首页：整个程序的落脚页。上面是各 Agent 与网关的状态，中间是网关拓扑图，最下面是常用入口。
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
  // 和侧栏一样：没有 Agent 接入网关时不显示网关那一行，也不催其他 Agent 接入。
  const gatewayInUse = connected.size > 0;

  // agent：Codex 自己的页面，先切到 Codex 再打开。
  const shortcuts: Array<{ route: Route; label: string; detail: string; icon: LucideIcon; agent?: ToolId }> = [
    { route: "userScripts", label: t("万物皆拓展"), detail: t("给 Codex、Claude 加功能的脚本"), icon: Blocks },
    { route: "context", label: t("MCP 与 Skills"), detail: t("一处管理所有 Agent 的 MCP 和 Skill"), icon: Network },
    { route: "sessions", label: t("会话"), detail: t("找回、继续各 Agent 的本地会话"), icon: MessagesSquare },
    { route: "relay", label: t("连接与供应商"), detail: t("切换 Codex 的供应商与连接方式"), icon: Cable, agent: "codex" },
    { route: "gatewayUsage", label: t("用量"), detail: t("调用次数、Token 与费用"), icon: BarChart3 },
    { route: "settings", label: t("设置"), detail: t("主题、更新、日志与诊断"), icon: Settings },
  ];

  // 自动接管紧挨着 Codex 那一行：打开后自己直接开 Codex 也有增强，不必再从这里点启动。
  // 关掉 Codex # 就没人监听，所以没开登录自启时在这一行提醒并给开关。
  const takeover = autoTakeoverView(autoTakeover);
  const takeoverNeedsLogin = autoTakeoverOn === true && watcherEnabled === false;
  const takeoverRow = (
    <CxRow
      badges={autoTakeoverOn ? <StatusBadge status={takeover.status} label={takeover.label} /> : null}
      detail={autoTakeoverOn
        ? [takeover.detail, takeoverNeedsLogin ? t("Codex # 没有设为登录时打开，退出 Codex # 后不会接管。") : ""].filter(Boolean).join(" ")
        : enhancementPlatform === "windows"
          ? t("打开后，直接打开 Codex（开始菜单、任务栏）也会自动接管并注入增强，不用再从 Codex # 启动。")
          : t("打开后，直接打开 Codex（Dock、启动台）也会自动接管并注入增强，不用再从 Codex # 启动。")}
      icon={<CxStatusIcon tone={autoTakeoverOn ? (takeover.status === "ok" ? "ok" : takeover.status === "failed" ? "danger" : "warn") : "off"}><Plug /></CxStatusIcon>}
      key="codex-auto-takeover"
      // 首页 Codex、Claude 各有一行自动接管：标题写明是哪一个。
      title={t("自动接管 Codex")}
      tooltip={t("官方 App 已在运行且没有调试端口时，会先退出再带参数重开（可能中断正在进行的操作）。")}
    >
      {takeoverNeedsLogin ? (
        <button className="cx-secondary" onClick={() => void actions.setWatcherEnabled(true)} type="button">{t("登录时打开 Codex #")}</button>
      ) : null}
      <label className="switch-row compact relay-master-switch relay-master-switch-compact">
        <input
          aria-label={t("开启自动接管")}
          checked={autoTakeoverOn === true}
          disabled={autoTakeoverOn === null}
          onChange={(event) => void actions.setAutoTakeover(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{t("自动接管")}</span>
        <ToggleVisual />
      </label>
    </CxRow>
  );

  const agentRow = (tool: ToolEntry) => {
    const viaGateway = connected.has(tool.id);
    if (tool.id === "codex") {
      const mode = viaGateway ? t("经共享供应商") : tool.activeRelayName ? tf("直连 · {0}", [tool.activeRelayName]) : t("直连");
      return [
        <CxRow
          detail={`${codexRunning ? t("运行中") : t("未运行")} · ${mode}`}
          icon={<CxStatusIcon tone={codexRunning ? "ok" : "off"}><AgentGlyph agent="codex" className="home-agent-glyph" /></CxStatusIcon>}
          key={tool.id}
          onClick={() => onOpenAgent(tool.id)}
          title={tool.name}
        >
          <button className="cx-secondary" disabled={launchPending} onClick={(event) => { event.stopPropagation(); onLaunchCodex(); }} type="button">
            {codexRunning ? <RotateCcw /> : <Play />}
            {codexRunning ? t("重启") : t("启动")}
          </button>
        </CxRow>,
        takeoverRow,
      ];
    }
    const row = (
      <CxRow
        detail={viaGateway ? t("已经通过 Codex # 本地服务接入") : gatewayInUse ? t("未接入本地服务") : t("直连")}
        icon={<CxStatusIcon tone={viaGateway ? "ok" : "off"}><AgentGlyph agent={tool.id} className="home-agent-glyph" /></CxStatusIcon>}
        key={tool.id}
        onClick={() => onOpenAgent(tool.id)}
        title={tool.name}
      >
        {viaGateway || !gatewayInUse ? <ChevronRight aria-hidden="true" className="cx-set-chevron" /> : (
          <button className="cx-secondary" onClick={(event) => { event.stopPropagation(); onNavigate("gateway"); }} type="button">{t("接入")}</button>
        )}
      </CxRow>
    );
    // Claude 那一行下面跟它的自动接管（只在完整功能模式下动作），和 Codex 行一样。
    return tool.id === "claude"
      ? [row, <ClaudeAutoTakeoverRow key="claude-auto-takeover" loginReminder onEnableLogin={() => actions.setWatcherEnabled(true)} title={t("自动接管 Claude")} showIcon />]
      : row;
  };

  const gatewayDetail = gateway?.helperRunning
    ? [
        tf("运行中 · 端口 {0}", [gateway.port]),
        tf("{0} 个供应商", [gateway.pool.length]),
        tf("{0} 个 Agent 已接入", [connected.size]),
        usage ? tf("今日 {0} 次调用", [usage.totals.calls]) : "",
      ].filter(Boolean).join(" · ")
    : t("本地服务未运行");

  return (
    <div className="tp-page home-page">
      <CxSection title={t("状态")}>
        <CxCard>
          {tools.map(agentRow)}
          {!gatewayInUse ? null : (
            <CxRow
              detail={gatewayDetail}
              icon={<CxStatusIcon tone={gateway?.helperRunning ? "ok" : "off"}><Waypoints /></CxStatusIcon>}
              onClick={() => onNavigate("gateway")}
              title={t("本地服务")}
            >
              <ChevronRight aria-hidden="true" className="cx-set-chevron" />
            </CxRow>
          )}
        </CxCard>
      </CxSection>

      <Suspense fallback={<CxCard className="hub-topology-card hub-topology-home">{null}</CxCard>}>
        <HubTopologyCard
          codex={{ running: codexRunning, providerName: tools.find((tool) => tool.id === "codex")?.activeRelayName ?? null }}
          notify={actions.showMessage}
          onNavigate={(next) => onNavigate(next)}
          onOpenAgent={(agent) => onOpenAgent(agent as ToolId)}
          roomy
        />
      </Suspense>

      <CxSection title={t("常用")}>
        <div className="home-shortcuts">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button className="home-shortcut" key={item.route} onClick={() => (item.agent ? onOpenAgent(item.agent, item.route) : onNavigate(item.route))} type="button">
                <Icon aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      </CxSection>

    </div>
  );
}
