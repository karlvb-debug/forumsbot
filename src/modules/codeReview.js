import { colors } from './constants.js';
import { newDocument } from './knowledge.js';

// Diff status → display marker. Single source of truth (was duplicated inline).
const DIFF_STATUS_MARK = { added: "+", removed: "−", modified: "~", renamed: "↷" };
const diffMark = (status) => DIFF_STATUS_MARK[status] || "·";

// ── GitHub PR import ─────────────────────────────────────────────────────────

export async function importGithubPr(url, token = "", { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch("/api/github-pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, token: token.trim() || undefined }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === "AbortError"
      ? `GitHub fetch timed out after ${Math.round(timeoutMs / 1000)}s`
      : `GitHub fetch failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  // Guard .json() — a proxy/error path may return a non-JSON body, which would
  // otherwise throw and mask the real HTTP status.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `GitHub fetch failed (${res.status})`);
  return data;
}

// ── Document builder ─────────────────────────────────────────────────────────

const LARGE_PR_FILE_THRESHOLD = 15;

export function buildCodeReviewDocuments(prData) {
  const now = new Date().toISOString();

  const overviewContent = [
    `# PR: ${prData.title}`,
    `**Author:** ${prData.user || "unknown"} · **Branch:** \`${prData.head}\` → \`${prData.base}\``,
    `**Changes:** +${prData.additions ?? "?"} −${prData.deletions ?? "?"} across ${prData.changed_files ?? "?"} files`,
    prData.html_url ? `**URL:** ${prData.html_url}` : "",
    "",
    "## PR Description",
    prData.body?.trim() || "_No description provided._",
    "",
    "## Review Findings",
    "_Actors will write their review findings here._"
  ].filter(s => s !== null).join("\n");

  const overview = newDocument({
    title: `PR Overview: ${prData.title}`,
    type: "document",
    content: overviewContent,
    aiEditable: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    wordCount: overviewContent.trim().split(/\s+/).filter(Boolean).length,
  });

  const docs = [overview];

  if ((prData.files || []).length <= LARGE_PR_FILE_THRESHOLD) {
    // Small PR: one combined diff document
    const diffLines = (prData.files || []).map(f => {
      return `### ${diffMark(f.status)} ${f.filename} (+${f.additions} −${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``;
    });
    const diffContent = diffLines.join("\n\n");
    docs.push(newDocument({
      title: "Changed Files — Diff",
      type: "document",
      content: diffContent,
      aiEditable: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      wordCount: diffContent.trim().split(/\s+/).filter(Boolean).length,
    }));
  } else {
    // Large PR: one document per file
    for (const f of (prData.files || [])) {
      const content = `${diffMark(f.status)} ${f.filename} (+${f.additions} −${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``;
      docs.push(newDocument({
        title: f.filename,
        type: "document",
        content,
        aiEditable: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
      }));
    }
  }

  return docs;
}

// ── Local folder import ──────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".h", ".cs",
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".env", ".sh", ".bash",
  ".css", ".html", ".svg", ".xml", ".graphql", ".sql"
]);

export async function importLocalFiles(fileList, { maxFiles = 20, maxBytesPerFile = 8192 } = {}) {
  const now = new Date().toISOString();
  const docs = [];
  let count = 0;

  for (const file of fileList) {
    if (count >= maxFiles) break;
    const ext = file.name.includes(".") ? "." + file.name.split(".").pop().toLowerCase() : "";
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    try {
      const text = await file.text();
      const content = text.slice(0, maxBytesPerFile) + (text.length > maxBytesPerFile ? "\n…[truncated]" : "");
      docs.push(newDocument({
        title: file.webkitRelativePath || file.name,
        type: "document",
        content,
        aiEditable: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
      }));
      count++;
    } catch {
      // Skip unreadable files silently
    }
  }
  return docs;
}

// ── Review session setup ─────────────────────────────────────────────────────

const REVIEW_ACTORS = [
  {
    name: "Review Lead",
    role: "Code review coordinator",
    canDirect: true,
    canManageCast: true,
    canResearch: false,
    canSeeThoughts: false,
    persona: "Coordinates the review panel. Tracks which issues are blockers vs suggestions. After each reviewer speaks, synthesises findings and drives toward a verdict.",
    goal: "Deliver a clear MERGE / REQUEST CHANGES / REJECT recommendation with a concise rationale.",
    voice: "Structured and decisive. Uses numbered lists for issues. Calls reviewers by name to direct discussion.",
    temperature: 0.7,
    color: "#c8a830"
  },
  {
    name: "Security Analyst",
    role: "Security reviewer",
    canDirect: false,
    canManageCast: false,
    canResearch: true,
    canSeeThoughts: false,
    persona: "Looks for injection attacks, auth bypasses, unsafe data handling, insecure defaults, dependency vulnerabilities, and information leakage. Assumes hostile input from every untrusted source.",
    goal: "Surface any security issue that would expose the system to attack or data breach. Block merges with critical vulnerabilities.",
    voice: "Direct and specific — cites exact filename and line context. Names the vulnerability class (e.g. 'SQL injection', 'IDOR'). Skips non-issues without comment.",
    temperature: 0.6,
    color: "#b84738"
  },
  {
    name: "Architecture Reviewer",
    role: "Design and structure critic",
    canDirect: false,
    canManageCast: false,
    canResearch: false,
    canSeeThoughts: false,
    persona: "Evaluates the structural impact of the change: coupling, abstraction leaks, naming clarity, consistency with existing codebase patterns, and long-term maintainability. Compares the PR approach to established idioms.",
    goal: "Ensure the change does not degrade maintainability, introduce design debt, or break established conventions.",
    voice: "Measured and specific. Proposes concrete alternatives when rejecting something. Acknowledges good design decisions too.",
    temperature: 0.7,
    color: "#355f9f"
  },
  {
    name: "Test Coverage Reviewer",
    role: "Quality and testability analyst",
    canDirect: false,
    canManageCast: false,
    canResearch: false,
    canSeeThoughts: false,
    persona: "Checks what is tested, what is not, and whether edge cases and error paths have coverage. Flags untestable code — hidden dependencies, no injection points, global state. Evaluates test quality, not just presence.",
    goal: "Ensure changed code is adequately covered and the test suite will catch regressions.",
    voice: "Methodical. Lists specific scenarios or branches that lack tests. Short and numbered.",
    temperature: 0.6,
    color: "#4f7d2d"
  }
];

export function buildCodeReviewSetup(prData) {
  return {
    scenario: {
      mode: "problem",
      title: `Code Review: ${prData.title}`,
      premise: `The panel is reviewing a GitHub pull request. The full diff is in the reference documents. The "PR Overview" working document tracks agreed findings and will hold the final verdict.\n\nPR: ${prData.title} (${prData.head} → ${prData.base})${prData.html_url ? `\n${prData.html_url}` : ""}`,
      objective: "Identify all bugs, security risks, performance issues, and design problems in the PR. Reach a clear MERGE / REQUEST CHANGES / REJECT verdict with specific actionable feedback."
    },
    actors: REVIEW_ACTORS.map((a, i) => ({
      ...a,
      id: crypto.randomUUID(),
      thoughts: "",
      enabled: true,
      expanded: false,
      relationships: {},
      color: a.color || colors[i % colors.length]
    }))
  };
}
