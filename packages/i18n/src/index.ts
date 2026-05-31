export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return Boolean(value && (locales as readonly string[]).includes(value));
}

const dictionaries = {
  en: {
    meta: {
      title: "ModelTruth.ai - The Anti-Cheat Engine for AI APIs",
      description: "Evidence-driven AI API monitoring for availability, authenticity and billing consistency."
    },
    nav: {
      playground: "Playground",
      providers: "Providers",
      methodology: "Methodology",
      pricing: "Pricing",
      workspace: "Workspace",
      evidence: "Evidence",
      login: "Log in"
    },
    home: {
      eyebrow: "Trust, but verify every token",
      title: "The Anti-Cheat Engine for AI APIs.",
      lede: "Monitor OpenAI-compatible endpoints for uptime, latency, model consistency, context handling and billing variance without supplier commissions.",
      primaryCta: "Run a smoke audit",
      secondaryCta: "Read methodology",
      truthBoard: "Provider Truth Board",
      metricsLabel: "ModelTruth product metrics",
      metricMonitoring: "continuous monitoring",
      metricCommission: "supplier commission",
      metricEvidence: "evidence exports"
    },
    playground: {
      eyebrow: "Stateless Playground",
      title: "Audit an endpoint without storing the key.",
      lede: "Free Playground keys are used only for the current run and redacted from logs.",
      submit: "Run audit"
    },
    login: {
      eyebrow: "Workspace Access",
      title: "Log in with a magic link.",
      lede: "ModelTruth uses email links for lightweight workspace sessions. In local development, the verification link is shown after submission.",
      email: "Work email",
      submit: "Send magic link",
      success: "Magic link created. Open this verification URL to start your session."
    },
    workspace: {
      eyebrow: "Pro Workspace",
      title: "Monitor private AI API nodes.",
      lede: "Save encrypted provider keys, schedule heartbeat audits and build evidence history for disputes.",
      name: "Node name",
      baseUrl: "Base URL",
      modelId: "Target model",
      apiKey: "API key",
      heartbeat: "Heartbeat seconds",
      deepAudit: "Deep audit seconds",
      create: "Create monitored node",
      empty: "No private nodes yet.",
      loginRequired: "Log in to manage workspace nodes.",
      refresh: "Refresh nodes",
      alertType: "Alert type",
      alertTarget: "Alert webhook URL",
      addAlert: "Add alert channel",
      alertChannels: "Alert channels",
      noAlerts: "No alert channels yet."
    },
    evidence: {
      eyebrow: "Evidence Center",
      title: "Export technical evidence without leaking secrets.",
      lede: "Review audit runs, risk flags and redacted evidence packages for provider disputes.",
      empty: "No audit evidence yet.",
      download: "Download JSON",
      riskFlags: "Risk Flags"
    },
    providers: [
      { slug: "openai", name: "OpenAI", status: "pass" },
      { slug: "anthropic", name: "Anthropic", status: "pass" },
      { slug: "google-gemini", name: "Google Gemini", status: "pass" },
      { slug: "openrouter", name: "OpenRouter", status: "warning" }
    ]
  },
  "zh-CN": {
    meta: {
      title: "ModelTruth.ai - AI API 反作弊审计引擎",
      description: "面向 AI API 可用性、真实性与计费一致性的证据驱动监控。"
    },
    nav: {
      playground: "测试台",
      providers: "供应商",
      methodology: "方法论",
      pricing: "价格",
      workspace: "Workspace",
      evidence: "证据中心",
      login: "登录"
    },
    home: {
      eyebrow: "Trust, but verify every token",
      title: "AI API 经济的反作弊引擎。",
      lede: "持续监控 OpenAI-compatible endpoint 的可用性、延迟、模型一致性、上下文能力和计费偏差，不接受供应商返佣。",
      primaryCta: "运行轻量审计",
      secondaryCta: "查看方法论",
      truthBoard: "Provider Truth Board",
      metricsLabel: "ModelTruth 产品指标",
      metricMonitoring: "持续监控",
      metricCommission: "供应商返佣",
      metricEvidence: "证据导出"
    },
    playground: {
      eyebrow: "无状态测试台",
      title: "不保存密钥，快速审计一个 endpoint。",
      lede: "Free Playground 的 API Key 只用于当前运行，并从日志中脱敏。",
      submit: "运行审计"
    },
    login: {
      eyebrow: "Workspace 访问",
      title: "使用 Magic Link 登录。",
      lede: "ModelTruth 使用邮件链接建立轻量 Workspace 会话。本地开发环境会在提交后直接显示验证链接。",
      email: "工作邮箱",
      submit: "发送登录链接",
      success: "登录链接已创建。打开下面的验证地址即可开始会话。"
    },
    workspace: {
      eyebrow: "Pro Workspace",
      title: "监控私有 AI API 节点。",
      lede: "保存加密后的供应商密钥，按计划执行心跳审计，并为争议生成证据历史。",
      name: "节点名称",
      baseUrl: "Base URL",
      modelId: "目标模型",
      apiKey: "API Key",
      heartbeat: "心跳间隔秒数",
      deepAudit: "深度审计秒数",
      create: "创建监控节点",
      empty: "还没有私有节点。",
      loginRequired: "登录后管理 Workspace 节点。",
      refresh: "刷新节点",
      alertType: "告警类型",
      alertTarget: "告警 Webhook URL",
      addAlert: "添加告警渠道",
      alertChannels: "告警渠道",
      noAlerts: "还没有告警渠道。"
    },
    evidence: {
      eyebrow: "Evidence Center",
      title: "导出不泄露密钥的技术证据。",
      lede: "查看审计运行、风险标记和脱敏证据包，用于供应商争议。",
      empty: "暂无审计证据。",
      download: "下载 JSON",
      riskFlags: "风险标记"
    },
    providers: [
      { slug: "openai", name: "OpenAI", status: "pass" },
      { slug: "anthropic", name: "Anthropic", status: "pass" },
      { slug: "google-gemini", name: "Google Gemini", status: "pass" },
      { slug: "openrouter", name: "OpenRouter", status: "warning" }
    ]
  }
} as const;

export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}
