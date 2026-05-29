// Core domain types for the Forum app.
// These drive IDE autocomplete and catch shape mismatches across the React/module boundary.

export interface Actor {
  id: string;
  name: string;
  role: string;
  persona: string;
  goal: string;
  voice: string;
  thoughts: string;
  relationships: Record<string, string>;
  enabled: boolean;
  expanded: boolean;
  temperature: number;
  color: string;
  // Permission flags (replaces legacy isDirector / isResearcher / isManager)
  canDirect: boolean;
  canManageCast: boolean;
  canResearch: boolean;
  canSeeThoughts: boolean;
}

export type MessageType = 'actor' | 'system' | 'user' | 'director' | 'researcher';

export interface Message {
  id: string;
  type: MessageType;
  speaker: string;
  content: string;
  thought?: string;
  color?: string;
  at?: string;
  metrics?: MessageMetrics;
}

export interface MessageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  durationMs?: number;
}

export interface KbEntry {
  id: string;
  type: 'document' | 'link';
  title: string;
  content: string;
  url?: string;
  actorIds: string[];  // empty = all actors
  createdAt: string;
  updatedAt: string;
}

// ── State sub-objects ────────────────────────────────────────────────────────

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  repeatPenalty: number;
  seed: number;
  seedEnabled: boolean;
  showThoughts: boolean;
  toolsEnabled: boolean;
  theme: 'dark' | 'light';
  includeTraces: boolean;
  gravitySensitivity: number;
  enablePreflightRouter: boolean;
  preflightThreshold: number;
  enableHypothesisSampling: boolean;
  hypothesisSampleCount: number;
  hypothesisAutoSelect: boolean;
  enableCrossSessionMemory: boolean;
  showInfluenceBars: boolean;
  streamingEnabled: boolean;
  turboMode: boolean;
  enableAdaptiveCompression: boolean;
  roundSnapshotEnabled: boolean;
  turnDelay: number;
}

export interface StopModal {
  reason: string;
  suggestedGoal: string;
}

export interface ConfirmModal {
  message: string;
  confirmLabel: string;
}

export interface EmbeddingProbeResult {
  ok: boolean;
  reason?: string;
}

export interface UI {
  activeTab: string;
  quickStartPrompt: string;
  quickStartDraft: unknown | null;
  quickStartStatus: string;
  quickStartHistory: Message[];
  quickStartTemperature: number;
  stopModal: StopModal | null;
  confirmModal: ConfirmModal | null;
  embeddingProbeResult: EmbeddingProbeResult | null;
  currentSpeaker: string;
  availableModels?: string[];
  chatModels?: string[];
  embeddingModels?: string[];
  tokenSpeed?: number | null;
}

export interface Memory {
  enabled: boolean;
  pinnedFacts: string[];
  sharedSummary: string;
  openQuestions: string[];
  dmState: string;
  pendingPinnedFacts: string[];
  pendingAnchors: Anchor[];
  recentDeltas: string[];
  cycleCount: number;
  turnsSinceSummary: number;
  lastSummaryMessageId: string;
  migratedLegacyMessages: boolean;
  archivedCount: number;
  isSummarizing: boolean;
  isDistilling?: boolean;
  distillingActor?: string;
}

export interface Anchor {
  id: string;
  text: string;
  speaker: string;
  color: string;
  suggestedAt: string;
}

export interface Telemetry {
  objectiveEmbedding: number[] | null;
  embeddedObjectiveText: string;
  currentAlignmentScore: number;
  alignmentMode: 'embedding' | 'keyword' | 'none';
  alignmentHistory: number[];
  nudgeTriggered: boolean;
}

export interface Outcomes {
  finalRecommendation: string;
  decisions: string[];
  rationale: string[];
  rejectedOptions: string[];
  actionItems: string[];
  risks: string[];
  lastExtractedAt: string;
  lastExtractMessageId: string;
  status: string;
  isExtracting: boolean;
  isExtractingOutcomes: boolean;
}

export interface AutoStop {
  enabled: boolean;
  goal: string;
  goalCheckEnabled: boolean;
  stopOnAllSkip: boolean;
  maxRoundsEnabled: boolean;
  maxRounds: number;
  roundsRun: number;
  status: string;
}

export interface SharedDocument {
  enabled: boolean;
  title: string;
  content: string;
  versions: DocumentVersion[];
  maxVersions: number;
  lineAttribution: LineAttribution[];
  showAttribution: boolean;
}

export interface DocumentVersion {
  content: string;
  timestamp?: string;
  at?: string;
  speaker?: string;
  chars?: number;
}

export interface LineAttribution {
  line: string;
  speaker: string;
  color: string;
}

export interface Scenario {
  mode: string;
  title: string;
  premise: string;
  objective: string;
}

export interface ContextInfo {
  maxContextLength: number;
  lastPromptTokens: number;
}

// ── Root state ───────────────────────────────────────────────────────────────

export interface ForumState {
  settings: Settings;
  ui: UI;
  memory: Memory;
  telemetry: Telemetry;
  diagnostics: {
    transitions: unknown[];
    warnings: unknown[];
    sessionsIndex: unknown[];
    apiCallLogs: unknown[];
    parseFailures: unknown[];
    outcomeExtractionLog: unknown[];
  };
  outcomes: Outcomes;
  autoStop: AutoStop;
  document: SharedDocument;
  scenario: Scenario;
  actors: Actor[];
  anchors: Anchor[];
  messages: Message[];
  turnQueue: string[];
  contextInfo: ContextInfo;
  autoRunning: boolean;
  _currentSessionId: string;
}

// ── Connection status ────────────────────────────────────────────────────────

export type ConnectionTone = 'ok' | 'error' | 'pending';

export interface ConnectionStatus {
  message: string;
  tone: ConnectionTone;
}

// ── Session record (IndexedDB) ───────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  scenarioTitle: string;
  actorCount: number;
  messageCount: number;
  savedAt: string;
  scenario?: Scenario;
  actors?: Actor[];
  memory?: Partial<Memory>;
  messages?: Message[];
  chunks?: unknown[];
}
