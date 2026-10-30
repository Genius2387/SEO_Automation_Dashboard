/**
 * Mock crawl results for development, offline testing, and continuous integration
 */
const mockCrawlData = {
  url: "https://example.com",
  statusCode: 200,
  responseTimeMs: 312,
  title: "Example Domain - Leading Cloud & Automation Solutions",
  metaDescription:
    "Explore modern web applications, AI automation tools, and real-time SEO intelligence with Example Domain.",
  h1: ["Supercharge Your Organic Reach With AI Automation"],
  h2: [
    "Enterprise SEO Capabilities",
    "Real-time Crawling Engine",
    "Actionable Claude Intelligence",
  ],
  canonicalUrl: "https://example.com/",
  robotsTag: "index, follow",
  wordCount: 1240,
  images: [
    { src: "/images/hero.webp", alt: "Dashboard Preview Hero", hasAlt: true },
    { src: "/images/chart.png", alt: "SEO Metrics Chart", hasAlt: true },
    { src: "/images/logo.svg", alt: "", hasAlt: false },
  ],
  links: [
    { href: "/features", text: "Features", isInternal: true },
    { href: "/pricing", text: "Pricing", isInternal: true },
    { href: "https://twitter.com/edgelink", text: "Twitter", isInternal: false },
  ],
  issues: [
    {
      type: "warning",
      code: "MISSING_ALT_TEXT",
      message: "1 image is missing descriptive alt text for accessibility and search indexing.",
      target: "/images/logo.svg",
    },
    {
      type: "notice",
      code: "CANONICAL_CHECK",
      message: "Canonical URL matches the current document URL.",
      target: "https://example.com/",
    },
  ],
};

const mockAiAnalysis = {
  overallScore: 84,
  categoryScores: {
    technical: 88,
    content: 82,
    userExperience: 82,
  },
  summary:
    "The target website displays solid semantic structure and responsive metadata. Improving image accessibility and expanding heading keyword targeting will yield immediate organic visibility gains.",
  strengths: [
    "Clean canonical tag setup preventing duplicate indexing",
    "Optimal title length and descriptive meta description",
    "Healthy content length exceeding 1,200 words",
  ],
  weaknesses: [
    "1 asset lacks descriptive alt text",
    "Subheading depth could better target long-tail search intent",
  ],
  recommendations: [
    {
      priority: "high",
      category: "technical",
      title: "Add Alt Attributes to SVG Assets",
      explanation:
        "Search engine crawlers and screen readers rely on alt attributes to understand image contents and context.",
      actionableSteps: [
        "Inspect `/images/logo.svg` and add `alt='Edgelink Company Logo'`",
        "Implement an automated lint check for missing alt tags in future builds",
      ],
    },
    {
      priority: "medium",
      category: "content",
      title: "Expand H2 Headings with Targeted Commercial Intent",
      explanation:
        "Heading tags are strongly weighted signals. Integrating primary service keywords directly improves ranking relevance.",
      actionableSteps: [
        "Include primary target keywords within at least two H2 headings",
        "Ensure headings follow strict hierarchical H1 -> H2 -> H3 nesting",
      ],
    },
  ],
  generatedAt: new Date().toISOString(),
};

module.exports = {
  mockCrawlData,
  mockAiAnalysis,
};
