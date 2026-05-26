export async function importGithubPr(url, token = "") {
  const res = await fetch("/api/github-pr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, token })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export function buildCodeReviewDocuments(prData) {
  const id1 = crypto.randomUUID();
  const overviewContent = [
    `# PR: ${prData.title}`,
    `**Author:** ${prData.user || "Unknown"} · **Branch:** ${prData.head} → ${prData.base}`,
    `**Changes:** +${prData.additions} -${prData.deletions} across ${prData.changed_files} files`,
    `**State:** ${prData.state}`,
    "",
    "## Description",
    prData.body || "(No description provided.)",
    "",
    "## Review Findings",
    "(Reviewers write findings here)"
  ].join("\n");

  const docs = [{
    id: id1,
    title: "PR Overview",
    type: "document",
    content: overviewContent,
    enabled: true,
    aiEditable: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    wordCount: overviewContent.trim().split(/\s+/).filter(Boolean).length,
    versions: [],
    maxVersions: 20,
    target: "all"
  }];

  const largePr = prData.files.length > 15;
  if (largePr) {
    for (const f of prData.files) {
      const content = `## ${f.filename}\nStatus: ${f.status} · +${f.additions} -${f.deletions}\n\n\`\`\`diff\n${f.patch || "(no diff)"}\n\`\`\``;
      docs.push({
        id: crypto.randomUUID(),
        title: f.filename,
        type: "document",
        content,
        enabled: true,
        aiEditable: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
        versions: [],
        maxVersions: 20,
        target: "all"
      });
    }
  } else {
    const diffLines = prData.files.map(f =>
      `## ${f.filename} [${f.status}] +${f.additions} -${f.deletions}\n\`\`\`diff\n${f.patch || "(no diff)"}\n\`\`\``
    ).join("\n\n");
    const diffContent = `# Changed Files — Diff\n\n${diffLines}`;
    docs.push({
      id: crypto.randomUUID(),
      title: "Changed Files — Diff",
      type: "document",
      content: diffContent,
      enabled: true,
      aiEditable: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      wordCount: diffContent.trim().split(/\s+/).filter(Boolean).length,
      versions: [],
      maxVersions: 20,
      target: "all"
    });
  }
  return docs;
}

const REVIEW_ACTORS = [
  {
    name: "Review Lead",
    role: "Code review coordinator",
    canDirect: true, canManageCast: true,
    persona: "Coordinates the review panel. Tracks which issues are blockers vs suggestions. After each reviewer speaks, synthesises findings and drives toward a verdict.",
    goal: "Deliver a clear MERGE / REQUEST CHANGES / REJECT recommendation with a concise rationale.",
    voice: "Structured and decisive. Uses numbered lists for issues.",
    temperature: 0.7, color: "#c8a830"
  },
  {
    name: "Security Analyst",
    role: "Security reviewer",
    canResearch: true, isResearcher: true,
    persona: "Looks for injection attacks, auth bypasses, unsafe data handling, insecure defaults, and information leakage. Assumes hostile input.",
    goal: "Surface any security issue that would expose the system to attack or data breach.",
    voice: "Direct. Cites exact file/line. Names the vulnerability class.",
    temperature: 0.6, color: "#b84738"
  },
  {
    name: "Architecture Reviewer",
    role: "Design and structure critic",
    persona: "Evaluates structural impact: coupling, abstraction leaks, naming clarity, consistency with existing patterns, and scalability.",
    goal: "Ensure the change doesn't degrade maintainability or introduce design debt.",
    voice: "Measured and specific. Proposes concrete alternatives when rejecting something.",
    temperature: 0.7, color: "#355f9f"
  },
  {
    name: "Test Coverage Reviewer",
    role: "Quality and testability analyst",
    persona: "Checks what's tested, what's not, and whether edge cases and error paths have coverage.",
    goal: "Ensure changed code is adequately covered and the test suite will catch regressions.",
    voice: "Methodical. Lists specific scenarios that lack tests. Short and numbered.",
    temperature: 0.6, color: "#4f7d2d"
  }
];

export function buildCodeReviewSetup(prData) {
  return {
    scenario: {
      mode: "problem",
      title: `Code Review: ${prData.title}`,
      premise: "The panel is reviewing a GitHub pull request. The PR diff is in your reference documents. The PR Overview document tracks review findings.",
      objective: "Identify all bugs, security risks, performance issues, and design problems. Deliver a clear MERGE / REQUEST CHANGES / REJECT verdict."
    },
    actors: REVIEW_ACTORS.map(t => ({
      id: crypto.randomUUID(),
      thoughts: "", relationships: {}, enabled: true, expanded: false,
      isResearcher: !!t.isResearcher, canManageCast: !!t.canManageCast,
      maxTokens: undefined, target: "all",
      ...t
    }))
  };
}
