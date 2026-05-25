import { state, saveState } from './modules/state.js';
import {
  els,
  render,
  syncFormFromState,
  readSettingsFromForm,
  renderConversationSummary,
  renderAutoStop,
  renderTranscript,
  renderModePills,
  renderStageHeader,
  renderTemperatureDisplay,
  renderChunkBrowser,
  renderTokenGauge,
  renderDocument,
  renderTelemetry,
  switchSidebarTab,
  switchDocView,
  isInitialized,
  setInitialized,
  getIsGenerating,
  validateEmbeddingModel,
  renderTurboState,
  showTranscriptSearch,
  hideTranscriptSearch,
  runTranscriptSearch,
  nextSearchMatch,
  prevSearchMatch,
  renderSessionsList,
  renderPendingAnchors,
  renderAnchors,
  showToast,
  renderStageMemoryHint,
  escapeHtml,
  renderKnowledgeBase
} from './modules/render.js';
import {
  loadModels,
  setStatus,
  startConnectionPing,
  restoreLastConnection,
  initApi
} from './modules/api.js';
import {
  runNextTurn,
  runRound,
  runAutoLoop,
  stopGeneration,
  addMessage,
  judgeGoal,
  participantCycleCount
} from './modules/turns.js';
import {
  summarizeMemory,
  approvePinnedFacts,
  compactPinnedFacts,
  clearArchivedMemory,
  extractOutcomes
} from './modules/memory.js';
import {
  savePreset,
  loadPresetFile,
  exportSession,
  copySessionToClipboard,
  confirmAndResetSession,
  confirmAndFullReset,
  addActor,
  addManager,
  generateQuickStart,
  applyQuickStartConfig,
  discardQuickStartConfig,
  renderQuickStartChat,
  saveCurrentSession,
  loadSession,
  generateActorFromDescription,
  openAiAssistantPanel,
  applyAssistantPatch,
  updateAiAssistantApplyButton
} from './modules/session.js';
import { initializeMemoryStorage, getAllChunks, getAllSessions, deleteSession } from './modules/db.js';
import { startTensionGridAnimation, stopTensionGridAnimation } from './modules/telemetry.js';
import { putKbEntry, fetchUrlContent, newKbEntry, countWords } from './modules/knowledge.js';

// Wire the els reference into api.js so setStatus, loadModels, etc. can access DOM elements
initApi(els);

function wireEvents() {
  [
    els.baseUrl,
    els.apiKey,
    els.model,
    els.embeddingModel,
    els.temperature,
    els.mode,
    els.title,
    els.premise,
    els.objective,
    els.quickStartPrompt,
    els.memoryEnabled,
    els.pinnedFacts,
    els.sharedSummary,
    els.openQuestions,
    els.dmState,
    els.outcomeRecommendation,
    els.outcomeDecisions,
    els.outcomeRationale,
    els.outcomeRejected,
    els.outcomeActions,
    els.outcomeRisks,
    els.autoStopEnabled,
    els.autoGoal,
    els.goalCheckEnabled,
    els.stopOnAllSkip,
    els.maxRoundsEnabled,
    els.showThoughts,
    els.toolsEnabled,
  ].filter(Boolean).forEach((element) => {
    const handler = () => {
      if (!isInitialized) return;
      readSettingsFromForm();
      renderConversationSummary();
      renderAutoStop();
      renderTranscript();
    };
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
  });

  els.embeddingModel.addEventListener("input", () => {
    if (isInitialized) validateEmbeddingModel(els.embeddingModel.value.trim());
  });
  els.embeddingModel.addEventListener("change", () => {
    if (isInitialized) validateEmbeddingModel(els.embeddingModel.value.trim());
  });

  // 💭 composer toggle — UI-only: expand/collapse thought blocks, no AI behavior change
  if (els.showThoughtsMirror) {
    els.showThoughtsMirror.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.showThoughts = els.showThoughtsMirror.checked;
      els.showThoughts.checked = state.settings.showThoughts;
      saveState();
      renderTranscript();
    });
  }

  // Generation settings — maxTokens, streaming, adaptive compression, cross-session memory
  if (els.maxTokensInput) {
    els.maxTokensInput.addEventListener("input", () => {
      if (!isInitialized) return;
      state.settings.maxTokens = Number(els.maxTokensInput.value) || 2000;
      if (els.maxTokensDisplay) els.maxTokensDisplay.textContent = state.settings.maxTokens;
      saveState();
    });
  }
  if (els.streamingEnabledInput) {
    els.streamingEnabledInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.streamingEnabled = els.streamingEnabledInput.checked;
      saveState();
    });
  }
  if (els.enableAdaptiveCompressionInput) {
    els.enableAdaptiveCompressionInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.enableAdaptiveCompression = els.enableAdaptiveCompressionInput.checked;
      saveState();
    });
  }
  if (els.enableCrossSessionMemoryInput) {
    els.enableCrossSessionMemoryInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.enableCrossSessionMemory = els.enableCrossSessionMemoryInput.checked;
      saveState();
    });
  }
  // Top-P slider
  if (els.topPInput) {
    els.topPInput.addEventListener("input", () => {
      if (!isInitialized) return;
      state.settings.topP = Number(els.topPInput.value) || 1.0;
      if (els.topPDisplay) els.topPDisplay.textContent = state.settings.topP.toFixed(2);
      saveState();
    });
  }
  // Repeat penalty slider
  if (els.repeatPenaltyInput) {
    els.repeatPenaltyInput.addEventListener("input", () => {
      if (!isInitialized) return;
      state.settings.repeatPenalty = Number(els.repeatPenaltyInput.value) || 1.0;
      if (els.repeatPenaltyDisplay) els.repeatPenaltyDisplay.textContent = state.settings.repeatPenalty.toFixed(2);
      saveState();
    });
  }
  // Seed toggle + value
  if (els.seedEnabledInput) {
    els.seedEnabledInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.seedEnabled = els.seedEnabledInput.checked;
      if (els.seedInput) els.seedInput.disabled = !state.settings.seedEnabled;
      saveState();
    });
  }
  if (els.seedInput) {
    els.seedInput.addEventListener("input", () => {
      if (!isInitialized) return;
      state.settings.seed = Number(els.seedInput.value) >= 0 ? Number(els.seedInput.value) : -1;
      saveState();
    });
  }
  // Document mirror toggle in Setup panel — syncs with documentEnabledInput in Doc panel
  if (els.documentEnabledMirror) {
    els.documentEnabledMirror.addEventListener("change", () => {
      if (!isInitialized) return;
      state.document.enabled = els.documentEnabledMirror.checked;
      if (els.documentEnabled) els.documentEnabled.checked = state.document.enabled;
      saveState();
      renderConversationSummary();
    });
  }

  // Sidebar tabs (Setup / Telemetry / Document)
  els.sidebarTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.sidebar;
      switchSidebarTab(name);
      // Start tension grid animation when telemetry tab is active
      if (name === "telemetry") {
        startTensionGridAnimation(els.tensionGridCanvas);
      } else {
        stopTensionGridAnimation();
      }
      if (name === "sessions") {
        getAllSessions().then(sessions => renderSessionsList(sessions));
      }
    });
  });

  // Doc view toggle (Preview / Edit)
  els.docViewBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchDocView(btn.dataset.docView));
  });

  // Sidebar resize handle
  if (els.sidebarResizeHandle) {
    let startX = 0, startWidth = 0;
    const layout = document.querySelector(".conversation-layout");
    const sidebar = document.querySelector(".conversation-sidebar");

    els.sidebarResizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      els.sidebarResizeHandle.classList.add("dragging");
      els.sidebarResizeHandle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const delta = startX - ev.clientX; // dragging left = wider sidebar
        const newWidth = Math.max(240, Math.min(window.innerWidth * 0.5, startWidth + delta));
        layout.style.gridTemplateColumns = `minmax(400px, 1fr) 6px ${newWidth}px`;
      };
      const onUp = () => {
        els.sidebarResizeHandle.classList.remove("dragging");
        els.sidebarResizeHandle.removeEventListener("pointermove", onMove);
        els.sidebarResizeHandle.removeEventListener("pointerup", onUp);
      };
      els.sidebarResizeHandle.addEventListener("pointermove", onMove);
      els.sidebarResizeHandle.addEventListener("pointerup", onUp);
    });
  }

  // Sidebar toggle button (collapses on desktop, opens drawer on mobile/tablet)
  if (els.toggleSidebarButton) {
    els.toggleSidebarButton.addEventListener("click", () => {
      const layout = document.querySelector(".conversation-layout");
      if (window.innerWidth <= 900) {
        layout.classList.toggle("sidebar-open");
        const isOpen = layout.classList.contains("sidebar-open");
        els.toggleSidebarButton.setAttribute("aria-expanded", String(isOpen));
      } else {
        layout.classList.toggle("sidebar-collapsed");
        const isCollapsed = layout.classList.contains("sidebar-collapsed");
        els.toggleSidebarButton.setAttribute("aria-expanded", String(!isCollapsed));
        if (isCollapsed) {
          layout.style.gridTemplateColumns = "";
        } else {
          const sidebar = document.querySelector(".conversation-sidebar");
          const width = sidebar ? sidebar.getBoundingClientRect().width : 300;
          layout.style.gridTemplateColumns = `minmax(400px, 1fr) 6px ${width || 300}px`;
        }
      }
    });
  }

  // Auto-close sidebar drawer when clicking inside the chat area (stage-panel) on mobile/tablet
  const stage = document.querySelector(".stage-panel");
  if (stage) {
    stage.addEventListener("click", (ev) => {
      const layout = document.querySelector(".conversation-layout");
      if (layout && window.innerWidth <= 900 && layout.classList.contains("sidebar-open")) {
        if (!ev.target.closest("#toggleSidebarButton")) {
          layout.classList.remove("sidebar-open");
          if (els.toggleSidebarButton) {
            els.toggleSidebarButton.setAttribute("aria-expanded", "false");
          }
        }
      }
    });
  }

  // Document panel events
  if (els.documentEnabled) {
    els.documentEnabled.addEventListener("change", () => {
      if (!isInitialized) return;
      state.document.enabled = els.documentEnabled.checked;
      if (els.documentEnabledMirror) els.documentEnabledMirror.checked = state.document.enabled;
      saveState();
      renderConversationSummary();
    });
  }
  if (els.documentTitle) {
    els.documentTitle.addEventListener("input", () => {
      if (!isInitialized) return;
      state.document.title = els.documentTitle.value;
      saveState();
    });
  }
  if (els.documentContent) {
    els.documentContent.addEventListener("input", () => {
      if (!isInitialized) return;
      state.document.content = els.documentContent.value;
      saveState();
    });
  }

  // Show Attribution toggle
  if (els.documentShowAttributionInput) {
    els.documentShowAttributionInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.document.showAttribution = els.documentShowAttributionInput.checked;
      saveState();
      renderDocument();
    });
  }
  if (els.documentCopy) {
    els.documentCopy.addEventListener("click", () => {
      navigator.clipboard.writeText(state.document.content || "").then(() => {
        els.documentCopy.textContent = "✅ Copied";
        setTimeout(() => { els.documentCopy.textContent = "📋 Copy"; }, 1500);
      });
    });
  }
  if (els.documentClear) {
    els.documentClear.addEventListener("click", () => {
      if (!confirm("Clear the document content? This cannot be undone.")) return;
      state.document.content = "";
      state.document.versions = [];
      saveState();
      renderDocument();
    });
  }

  // Document history scrubbing
  if (els.documentHistorySlider) {
    els.documentHistorySlider.addEventListener("input", () => {
      if (!isInitialized) return;
      state.ui.viewingVersionIndex = Number(els.documentHistorySlider.value);
      
      // If editing, switch to preview view to see historical render
      const isEditView = els.docEditView && els.docEditView.style.display !== "none";
      if (isEditView) {
        switchDocView("preview");
      } else {
        renderDocument();
      }
      saveState();
    });
  }

  if (els.documentRestoreButton) {
    els.documentRestoreButton.addEventListener("click", () => {
      if (!isInitialized) return;
      const index = state.ui.viewingVersionIndex;
      const versions = state.document.versions || [];
      if (index >= 0 && index < versions.length) {
        if (!confirm(`Restore the document to Version ${index + 1}?`)) return;
        
        const historicalContent = versions[index].content || "";
        
        // Save current draft to history first so we don't lose it
        state.document.versions.push({
          author: "User",
          content: state.document.content,
          timestamp: new Date().toISOString()
        });
        
        if (state.document.versions.length > (state.document.maxVersions || 20)) {
          state.document.versions = state.document.versions.slice(-(state.document.maxVersions || 20));
        }
        
        state.document.content = historicalContent;
        state.ui.viewingVersionIndex = state.document.versions.length;
        saveState();
        renderDocument();
      }
    });
  }

  // Mode pill buttons
  els.modePills.forEach((pill) => {
    pill.addEventListener("click", () => {
      state.scenario.mode = pill.dataset.mode;
      els.mode.value = pill.dataset.mode;
      renderModePills();
      renderStageHeader();
      renderConversationSummary();
      saveState();
    });
  });

  // Temperature slider live display
  if (els.temperature) {
    els.temperature.addEventListener("input", () => {
      renderTemperatureDisplay();
    });
  }

  if (els.quickStartTemp) {
    els.quickStartTemp.addEventListener("input", () => {
      state.ui.quickStartTemperature = Number(els.quickStartTemp.value || 0.8);
      if (els.quickStartTempDisplay) {
        els.quickStartTempDisplay.textContent = state.ui.quickStartTemperature.toFixed(2);
      }
      saveState();
    });
  }

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = els.userInput.value.trim();
    if (!content) return;
    readSettingsFromForm();
    await addMessage({ type: "user", speaker: "You", content, color: "var(--blue)" });
    els.userInput.value = "";
  });

  // Enter in the chat textarea: send if text is present, trigger next AI turn if empty.
  // Shift+Enter inserts a newline as normal.
  els.userInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const content = els.userInput.value.trim();
    if (content) {
      els.composer.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else if (!getIsGenerating()) {
      runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
    }
  });

  // Global keyboard shortcuts (non-conflicting with browser defaults)
  document.addEventListener("keydown", (e) => {
    // Escape — close search bar or stop generation
    if (e.key === "Escape") {
      const bar = document.getElementById("transcriptSearchBar");
      if (bar && bar.style.display !== "none") {
        e.preventDefault();
        hideTranscriptSearch();
        return;
      }
      if (getIsGenerating()) {
        e.preventDefault();
        stopGeneration();
        return;
      }
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Ctrl+Enter — global fallback: send or trigger next AI turn
    // Guards: not when focus is in a sidebar field; Ctrl+F/N/R left to the browser
    if (e.key === "Enter" && !e.shiftKey) {
      const focused = document.activeElement;
      const inSidebarInput = focused &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT") &&
        focused !== els.userInput;
      if (!inSidebarInput) {
        const content = els.userInput.value.trim();
        e.preventDefault();
        if (content) {
          els.composer.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        } else if (!getIsGenerating()) {
          runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
        }
      }
    }
  });

  // Bare Enter — run next AI turn when no input field is focused
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key !== "Enter") return;
    const focused = document.activeElement;
    const inInput = focused &&
      (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" ||
       focused.tagName === "SELECT" || focused.isContentEditable);
    if (inInput) return;
    if (getIsGenerating()) return;
    e.preventDefault();
    runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
  });

  // ⌘K / Ctrl+K — toggle AI Assistant panel
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      toggleAiAssistantPanel();
      if (aiAssistantPanel && !aiAssistantPanel.hidden) {
        document.getElementById("aiAssistantInput")?.focus();
      }
    }
  });

  // Transcript search bar events
  const transcriptSearchInput = document.getElementById("transcriptSearchInput");
  const transcriptSearchPrev = document.getElementById("transcriptSearchPrev");
  const transcriptSearchNext = document.getElementById("transcriptSearchNext");
  const transcriptSearchClose = document.getElementById("transcriptSearchClose");
  if (transcriptSearchInput) {
    transcriptSearchInput.addEventListener("input", () => runTranscriptSearch(transcriptSearchInput.value));
    transcriptSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.shiftKey ? prevSearchMatch() : nextSearchMatch(); }
      if (e.key === "Escape") hideTranscriptSearch();
    });
  }
  if (transcriptSearchPrev) transcriptSearchPrev.addEventListener("click", prevSearchMatch);
  if (transcriptSearchNext) transcriptSearchNext.addEventListener("click", nextSearchMatch);
  if (transcriptSearchClose) transcriptSearchClose.addEventListener("click", hideTranscriptSearch);

  els.loadModels.addEventListener("click", loadModels);
  els.nextTurn.addEventListener("click", () => runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); }));
  els.round.addEventListener("click", () => runRound().then(ok => { if (ok) saveCurrentSession().catch(console.warn); }));
  els.auto.addEventListener("click", runAutoLoop);

  if (els.turnDelaySlider) {
    els.turnDelaySlider.addEventListener("input", () => {
      const delay = Number(els.turnDelaySlider.value) || 0;
      state.settings.turnDelay = delay;
      if (els.turnDelayDisplay) els.turnDelayDisplay.textContent = delay === 0 ? "Instant" : `${delay}s`;
      saveState();
    });
  }
  els.clearConversation.addEventListener("click", confirmAndResetSession);
  els.copySession.addEventListener("click", copySessionToClipboard);
  els.stop.addEventListener("click", stopGeneration);
  // AI Assistant panel toggle (header button + sidebar button)
  const aiAssistantPanel = document.getElementById("aiAssistantPanel");
  const aiAssistantToggle = document.getElementById("aiAssistantToggle");
  const aiAssistantCloseBtn = document.getElementById("aiAssistantCloseBtn");
  const openAiAssistantBtnSidebar = document.getElementById("openAiAssistantBtn");

  function toggleAiAssistantPanel() {
    if (aiAssistantPanel) aiAssistantPanel.hidden = !aiAssistantPanel.hidden;
  }
  if (aiAssistantToggle) aiAssistantToggle.addEventListener("click", toggleAiAssistantPanel);
  if (aiAssistantCloseBtn) aiAssistantCloseBtn.addEventListener("click", () => { if (aiAssistantPanel) aiAssistantPanel.hidden = true; });
  if (openAiAssistantBtnSidebar) openAiAssistantBtnSidebar.addEventListener("click", () => { if (aiAssistantPanel) aiAssistantPanel.hidden = false; });

  // AI Assistant send
  const aiAssistantSendBtn = document.getElementById("aiAssistantSendBtn");
  if (aiAssistantSendBtn) aiAssistantSendBtn.addEventListener("click", generateQuickStart);

  // AI Assistant input — Enter to send, Shift+Enter for newline
  const aiAssistantInput = document.getElementById("aiAssistantInput");
  if (aiAssistantInput) {
    aiAssistantInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        generateQuickStart();
      }
    });
  }

  // AI Assistant apply/clear
  const aiAssistantApplyBtn = document.getElementById("aiAssistantApplyBtn");
  const aiAssistantClearBtn = document.getElementById("aiAssistantClearBtn");
  if (aiAssistantApplyBtn) aiAssistantApplyBtn.addEventListener("click", applyQuickStartConfig);
  if (aiAssistantClearBtn) aiAssistantClearBtn.addEventListener("click", discardQuickStartConfig);

  // Legacy sidebar Quick Setup elements (null-safe — elements no longer exist in HTML)
  if (els.generateQuickStart) els.generateQuickStart.addEventListener("click", generateQuickStart);
  if (els.applyQuickStart) els.applyQuickStart.addEventListener("click", () => applyQuickStartConfig());
  if (els.discardQuickStart) els.discardQuickStart.addEventListener("click", discardQuickStartConfig);

  els.addActor.addEventListener("click", () => addActor(false));
  els.addResearcher.addEventListener("click", () => addActor(true));
  document.getElementById("addManagerButton")?.addEventListener("click", addManager);
  document.getElementById("addActorFromDescBtn")?.addEventListener("click", generateActorFromDescription);
  els.savePreset.addEventListener("click", savePreset);
  els.loadPreset.addEventListener("click", () => els.presetFile.click());
  els.exportSession.addEventListener("click", () => exportSession());

  // Sessions panel
  document.getElementById("saveSessionBtn")?.addEventListener("click", async () => {
    await saveCurrentSession();
    const sessions = await getAllSessions();
    renderSessionsList(sessions);
  });
  document.getElementById("sessionsList")?.addEventListener("click", async (e) => {
    const loadBtn = e.target.closest(".session-load-btn");
    const delBtn = e.target.closest(".session-delete-btn");
    if (loadBtn) {
      const id = loadBtn.dataset.sessionId;
      const sessions = await getAllSessions();
      const session = sessions.find(s => s.id === id);
      if (session) await loadSession(session);
    } else if (delBtn) {
      const id = delBtn.dataset.sessionId;
      await deleteSession(id);
      const sessions = await getAllSessions();
      renderSessionsList(sessions);
    }
  });
  // ── Knowledge Base panel ─────────────────────────────────────────────────

  // Helpers: build target picker (All + per-actor checkboxes) in a container
  function buildKbTargetPicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    const allLabel = document.createElement("label");
    allLabel.className = "kb-target-option";
    allLabel.innerHTML = `<input type="checkbox" class="kb-target-all" checked> All actors`;
    container.appendChild(allLabel);
    for (const actor of state.actors) {
      const lbl = document.createElement("label");
      lbl.className = "kb-target-option";
      const swatch = `<span class="kb-swatch" style="background:${actor.color}"></span>`;
      lbl.innerHTML = `<input type="checkbox" class="kb-target-actor" data-actor-id="${actor.id}" checked> ${swatch}${escapeHtml(actor.name)}`;
      container.appendChild(lbl);
    }
    // Toggle actor checkboxes based on "All" state
    allLabel.querySelector("input").addEventListener("change", (e) => {
      container.querySelectorAll(".kb-target-actor").forEach(cb => { cb.disabled = e.target.checked; });
    });
    container.querySelectorAll(".kb-target-actor").forEach(cb => { cb.disabled = true; }); // start disabled (all=true)
  }

  function getKbTargetValue(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return "all";
    const allCb = container.querySelector(".kb-target-all");
    if (!allCb || allCb.checked) return "all";
    const ids = [];
    container.querySelectorAll(".kb-target-actor:checked").forEach(cb => ids.push(cb.dataset.actorId));
    return ids.length ? ids : "all";
  }

  const kbAddDocBtn = document.getElementById("kbAddDocBtn");
  const kbAddDocForm = document.getElementById("kbAddDocForm");
  const kbAddLinkBtn = document.getElementById("kbAddLinkBtn");
  const kbAddLinkForm = document.getElementById("kbAddLinkForm");

  kbAddDocBtn?.addEventListener("click", () => {
    kbAddDocForm.style.display = kbAddDocForm.style.display === "none" ? "" : "none";
    kbAddLinkForm.style.display = "none";
    if (kbAddDocForm.style.display !== "none") buildKbTargetPicker("kbDocTargetPicker");
  });

  kbAddLinkBtn?.addEventListener("click", () => {
    kbAddLinkForm.style.display = kbAddLinkForm.style.display === "none" ? "" : "none";
    kbAddDocForm.style.display = "none";
    if (kbAddLinkForm.style.display !== "none") buildKbTargetPicker("kbLinkTargetPicker");
  });

  document.getElementById("kbDocCancelBtn")?.addEventListener("click", () => {
    kbAddDocForm.style.display = "none";
  });
  document.getElementById("kbLinkCancelBtn")?.addEventListener("click", () => {
    kbAddLinkForm.style.display = "none";
    document.getElementById("kbLinkPreviewArea").style.display = "none";
    document.getElementById("kbLinkStatus").textContent = "";
  });

  document.getElementById("kbDocSaveBtn")?.addEventListener("click", async () => {
    const title = document.getElementById("kbDocTitle")?.value.trim();
    const content = document.getElementById("kbDocContent")?.value.trim();
    if (!title || !content) { setStatus("Title and content are required.", "warn"); return; }
    const entry = newKbEntry({ title, type: "document", content, target: getKbTargetValue("kbDocTargetPicker"), wordCount: countWords(content) });
    await putKbEntry(entry);
    kbAddDocForm.style.display = "none";
    document.getElementById("kbDocTitle").value = "";
    document.getElementById("kbDocContent").value = "";
    renderKnowledgeBase();
    setStatus(`Saved document "${title}".`, "ok");
  });

  let _kbLinkFetched = "";
  document.getElementById("kbLinkFetchBtn")?.addEventListener("click", async () => {
    const url = document.getElementById("kbLinkUrl")?.value.trim();
    if (!url) { setStatus("Enter a URL first.", "warn"); return; }
    const statusEl = document.getElementById("kbLinkStatus");
    statusEl.textContent = "Fetching…";
    try {
      const text = await fetchUrlContent(url);
      _kbLinkFetched = text;
      const titleInput = document.getElementById("kbLinkTitle");
      if (!titleInput.value) titleInput.value = new URL(url).hostname;
      document.getElementById("kbLinkPreviewArea").style.display = "";
      buildKbTargetPicker("kbLinkTargetPicker");
      statusEl.textContent = `Fetched ${countWords(text).toLocaleString()} words`;
    } catch (err) {
      statusEl.textContent = "Error: " + (err.message || "fetch failed");
    }
  });

  document.getElementById("kbLinkSaveBtn")?.addEventListener("click", async () => {
    const url = document.getElementById("kbLinkUrl")?.value.trim();
    const title = document.getElementById("kbLinkTitle")?.value.trim() || new URL(url).hostname;
    if (!_kbLinkFetched) { setStatus("Fetch the URL first.", "warn"); return; }
    const entry = newKbEntry({ title, type: "link", url, content: _kbLinkFetched, target: getKbTargetValue("kbLinkTargetPicker"), wordCount: countWords(_kbLinkFetched) });
    await putKbEntry(entry);
    kbAddLinkForm.style.display = "none";
    document.getElementById("kbLinkPreviewArea").style.display = "none";
    document.getElementById("kbLinkUrl").value = "";
    document.getElementById("kbLinkTitle").value = "";
    document.getElementById("kbLinkStatus").textContent = "";
    _kbLinkFetched = "";
    renderKnowledgeBase();
    setStatus(`Saved link "${title}".`, "ok");
  });

  els.reset.addEventListener("click", confirmAndFullReset);
  els.summarizeNow.addEventListener("click", () => summarizeMemory("manual"));
  els.rebuildMemory.addEventListener("click", () => summarizeMemory("rebuild", state.messages.slice(-24), { reset: true }));
  els.approveFacts.addEventListener("click", approvePinnedFacts);
  els.clearArchive.addEventListener("click", clearArchivedMemory);
  document.getElementById("compactFactsButton")?.addEventListener("click", compactPinnedFacts);
  document.getElementById("browseChunksButton")?.addEventListener("click", async (e) => {
    e.stopPropagation(); // don't toggle the <details>
    const btn = e.currentTarget;
    btn.textContent = "Loading…";
    btn.disabled = true;
    try {
      const chunks = await getAllChunks();
      renderChunkBrowser(chunks);
      btn.textContent = `Loaded (${chunks.length})`;
    } catch (err) {
      btn.textContent = "Error";
      console.error("Chunk browser load failed:", err);
    } finally {
      btn.disabled = false;
    }
  });
  els.extractOutcomes.addEventListener("click", extractOutcomes);
  els.checkGoalNow.addEventListener("click", () => judgeGoal(state.messages.slice(-participantCycleCount()), { manual: true }));
  els.presetFile.addEventListener("change", () => {
    const [file] = els.presetFile.files;
    if (file) loadPresetFile(file);
    els.presetFile.value = "";
  });
  els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || "dark";
    state.settings.theme = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.settings.theme;
    saveState();
  });

  if (els.turboButton) {
    els.turboButton.addEventListener("click", () => {
      state.settings.turboMode = !state.settings.turboMode;
      saveState();
      renderTurboState();
    });
  }

  // ── Telemetry controls ────────────────────────────────────────
  if (els.gravitySensitivityInput) {
    els.gravitySensitivityInput.addEventListener("input", () => {
      if (!isInitialized) return;
      const val = Number(els.gravitySensitivityInput.value);
      state.settings.gravitySensitivity = val;
      if (els.gravitySensitivityDisplay) els.gravitySensitivityDisplay.textContent = `${val}%`;
      saveState();
    });
  }

  if (els.includeTracesInput) {
    els.includeTracesInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.includeTraces = els.includeTracesInput.checked;
      saveState();
    });
  }

  if (els.manualNudgeButton) {
    els.manualNudgeButton.addEventListener("click", () => {
      if (!isInitialized) return;
      state.telemetry.nudgeTriggered = true;
      saveState();
      els.manualNudgeButton.textContent = "✅ Nudge Queued";
      setTimeout(() => {
        els.manualNudgeButton.textContent = "Trigger Steering Nudge";
      }, 2000);
    });
  }

  // Listen for generation errors and show toast
  document.addEventListener("generationError", (e) => {
    showToast(e.detail?.message || "Generation failed.", "error");
  });

  // Listen for telemetry updates to refresh the dial
  document.addEventListener("telemetryUpdated", () => {
    renderTelemetry();
  });

  // Actor turn indicator — highlight the active speaker's card in the roster
  document.addEventListener("speakerChanged", ({ detail: { name } }) => {
    document.querySelectorAll(".actor-card").forEach(card => {
      // Regular actors: match by dataset actorId
      const actor = state.actors.find(a => a.id === card.dataset.actorId);
      if (actor) {
        card.classList.toggle("is-speaking", !!name && actor.name === name);
      }
      // Director card: match by DM name
      if (card.classList.contains("director-card")) {
        card.classList.toggle("is-speaking", !!name && name === state.dm.name);
      }
    });
  });

  // Director anchor suggestions — re-render pending anchors panel on each suggestion
  document.addEventListener("anchorSuggested", () => {
    renderPendingAnchors();
    // Switch to memory tab so the user sees the suggestion
    const memTab = document.querySelector('[data-sidebar="memory"]');
    if (memTab && !document.getElementById('pendingAnchorsList')?.closest('.sidebar-panel')?.style.display?.includes('none')) {
      memTab.click();
    }
  });

  // Show/hide the embedding warning banner based on live probe results
  document.addEventListener("embeddingProbeResult", (e) => {
    const { ok, reason } = e.detail || {};
    if (!els.embeddingWarning) return;
    if (ok) {
      els.embeddingWarning.style.display = "none";
    } else {
      els.embeddingWarning.style.display = "flex";
      const msgEl = els.embeddingWarning.querySelector("span:last-child");
      if (msgEl) msgEl.textContent = reason || "Embedding unavailable — semantic memory is in keyword-only mode.";
    }
  });

  // ── Sprint 5: Preflight Router toggle ────────────────────────
  if (els.enablePreflightRouterInput) {
    els.enablePreflightRouterInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.enablePreflightRouter = els.enablePreflightRouterInput.checked;
      saveState();
    });
  }

  // Round Snapshot (KV cache prefix stability)
  const roundSnapshotInput = document.getElementById("roundSnapshotInput");
  if (roundSnapshotInput) {
    roundSnapshotInput.checked = state.settings.roundSnapshotEnabled !== false;
    roundSnapshotInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.roundSnapshotEnabled = roundSnapshotInput.checked;
      saveState();
    });
  }

  // ── Sprint 5: Hypothesis Sampling controls ────────────────────
  function syncHypothesisControls() {
    const on = state.settings.enableHypothesisSampling;
    if (els.hypothesisSamplingControls) {
      els.hypothesisSamplingControls.style.display = on ? "flex" : "none";
    }
  }

  if (els.enableHypothesisSamplingInput) {
    els.enableHypothesisSamplingInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.enableHypothesisSampling = els.enableHypothesisSamplingInput.checked;
      saveState();
      syncHypothesisControls();
    });
  }

  if (els.hypothesisSampleCountInput) {
    els.hypothesisSampleCountInput.addEventListener("input", () => {
      if (!isInitialized) return;
      const val = Number(els.hypothesisSampleCountInput.value);
      state.settings.hypothesisSampleCount = val;
      if (els.hypothesisSampleCountDisplay) els.hypothesisSampleCountDisplay.textContent = String(val);
      saveState();
    });
  }

  if (els.hypothesisAutoSelectInput) {
    els.hypothesisAutoSelectInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.hypothesisAutoSelect = els.hypothesisAutoSelectInput.checked;
      saveState();
    });
  }

  // Sprint 7B: Show Influence Bars toggle
  if (els.showInfluenceBarsInput) {
    els.showInfluenceBarsInput.addEventListener("change", () => {
      if (!isInitialized) return;
      state.settings.showInfluenceBars = els.showInfluenceBarsInput.checked;
      saveState();
      renderTranscript();
    });
  }
}

async function startApp() {
  wireEvents();
  restoreLastConnection();
  syncFormFromState();
  setInitialized(true);

  // Update token gauge whenever a chat response returns usage data or context length is fetched
  document.addEventListener("tokenUsageUpdated", renderTokenGauge);
  try {
    await initializeMemoryStorage();
    saveState();
    render();
    renderQuickStartChat();
  } catch (err) {
    console.warn("Memory storage initialization failed, app continues:", err);
  }
  startConnectionPing();
}

startApp();
