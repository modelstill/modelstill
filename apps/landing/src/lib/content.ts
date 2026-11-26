export const DOCS_URL = "https://docs.modelstill.com";

export const SITE_URL = "https://modelstill.com";

type NavItem = { label: string; href: string; menu?: "product"; note?: string };

export const NAV: readonly NavItem[] = [
  { label: "Evaluate", href: "/#evaluate", menu: "product", note: "Golden datasets and scores with intervals" },
  { label: "Gate", href: "/#evaluate", menu: "product", note: "Pass or fail every change against a baseline" },
  { label: "Swap", href: "/#swap", menu: "product", note: "Replay recorded calls through a cheaper model" },
  { label: "Monitor", href: "/#swap", menu: "product", note: "Catch a model changing behind the same name" },
  { label: "Docs", href: DOCS_URL },
  { label: "Blog", href: "/blog" },
];

export const GITHUB = { label: "ModelStill on GitHub", href: "https://github.com/modelstill/modelstill" } as const;

export const CTA = { label: "Get started", href: `${DOCS_URL}/quickstart` } as const;

export const HERO = {
  before: "The release",
  after: "gate for",
  emphasis: "dependable",
  rest: "AI",
  tagline: "One gate, every model and prompt change.",
} as const;

export const CANDIDATES = [
  { label: "Prompt v12", at: 6.4, atSmall: 1, baseline: 5, candidate: 2.75, tone: "leaf" },
  { label: "Small model", at: 32.3, atSmall: 35, baseline: 8, candidate: 4.35, tone: "sun" },
  { label: "Provider swap", at: 56, atSmall: 61, baseline: 6.4, candidate: 3.5, tone: "sky" },
  { label: "Quantised", at: 82.7, atSmall: 85, baseline: 3, candidate: 1.65, tone: "plum" },
] as const;

export const RUN_DAYS = ["Run 12", "Run 13", "Run 14", "Run 15", "Run 16", "Run 17", "Run 18"] as const;

export const TASKS = [
  { name: "Ticket priority", cases: "1,342 cases", score: "2.36%", delta: "2.65%", better: true, tone: "leaf", icon: "ticket" },
  { name: "Invoice fields", cases: "873 cases", score: "3.12%", delta: "4.05%", better: false, tone: "sky", icon: "receipt" },
  { name: "Support routing", cases: "1,022 cases", score: "1.87%", delta: "2.95%", better: true, tone: "sun", icon: "route" },
  { name: "Contract review", cases: "456 cases", score: "2.10%", delta: "3.75%", better: true, tone: "plum", icon: "file" },
  { name: "Search ranking", cases: "1,200 cases", score: "4.50%", delta: "5.20%", better: false, tone: "leaf", icon: "search" },
] as const;

export const WORKS_WITH = [
  { name: "Langfuse", logo: "/logos/langfuse.svg" },
  { name: "Braintrust", logo: "/logos/braintrust.png" },
  { name: "OpenTelemetry", logo: "/logos/opentelemetry.svg" },
  { name: "LiteLLM", logo: "/logos/litellm.png" },
  { name: "pytest", logo: "/logos/pytest.svg" },
  { name: "GitHub Actions", logo: "/logos/github-actions.png" },
] as const;

type FooterLink = { label: string; path: string; site?: boolean };

type FooterColumn = { title: string; links: FooterLink[] };

export const FOOTER: { blurb: string; columns: FooterColumn[]; licence: string; copyright: string } = {
  blurb: "ModelStill checks every model and prompt change against a baseline, so nothing ships on a guess.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Evaluation sets", path: "/dashboard/datasets" },
        { label: "Release gate", path: "/dashboard/gates" },
        { label: "Model swaps", path: "/guides/model-swap" },
        { label: "Drift watch", path: "/guides/monitor-a-task" },
        { label: "Distillation", path: "/guides/distil-a-task" },
      ],
    },
    {
      title: "Docs",
      links: [
        { label: "Quickstart", path: "/quickstart" },
        { label: "Guides", path: "/guides" },
        { label: "CLI reference", path: "/reference/cli" },
        { label: "API reference", path: "/api-reference" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Blog", path: "/blog", site: true },
        { label: "Changelog", path: "/changelog" },
        { label: "FAQ", path: "/faq" },
        { label: "MCP server", path: "/ai-agents/mcp" },
      ],
    },
  ],
  licence: "Open source under Apache-2.0",
  copyright: "ModelStill \u00a92026",
};

export const EVALUATE = {
  id: "evaluate",
  features: [
    { icon: "stack", tone: "sun", title: "Golden datasets", text: "Build versioned test cases from the calls you already log." },
    { icon: "ruler", tone: "sky", title: "Honest scores", text: "Every score carries an interval, so noise is never mistaken for progress." },
    { icon: "shield", tone: "plum", title: "Release gate", text: "Compare a candidate with the accepted baseline, case by case, in CI." },
    { icon: "users", tone: "leaf", title: "Validated judges", text: "Check an LLM-as-a-judge against human labels, and send disagreements to a person." },
  ],
} as const;

export const SWAP = {
  id: "swap",
  before: "Swap models",
  after: "calmly.",
  features: [
    { icon: "swap", tone: "sun", title: "Model swaps", text: "Replay recorded calls through a cheaper model and see how often it agrees." },
    { icon: "pulse", tone: "sky", title: "Drift watch", text: "Known-answer checks catch a provider changing a model behind the same name." },
    {
      icon: "flask",
      tone: "plum",
      title: "A model you own",
      text: "Train a small model on recorded answers and serve it with the cloud model as fallback. It takes over only after it passes the gate.",
    },
  ],
} as const;

export const GATE_CHECKS = ["Regression", "Flip rate", "Cost", "Latency"] as const;
