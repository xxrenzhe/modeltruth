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
    providers: [
      { slug: "openai", name: "OpenAI", status: "pass" },
      { slug: "anthropic", name: "Anthropic", status: "pass" },
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
    providers: [
      { slug: "openai", name: "OpenAI", status: "pass" },
      { slug: "anthropic", name: "Anthropic", status: "pass" },
      { slug: "openrouter", name: "OpenRouter", status: "warning" }
    ]
  }
} as const;

export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}
