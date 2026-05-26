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
  renderSessionsList
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
  addActorFromTemplate,
  generateQuickStart,
  applyQuickStartConfig,
  discardQuickStartConfig,
  saveCurrentSession,
  loadSession,
  generateActorFromDescription
} from './modules/session.js';
import { initializeMemoryStorage, getAllChunks, getAllSessions, deleteSession } from './modules/db.js';
import { startTensionGridAnimation, stopTensionGridAnimation } from './modules/telemetry.js';

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
    els.dmEnabled,
    els.dmName,
    els.dmPersona,
    els.dmPrivate,
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
    els.quickStartTemp
  ].forEach((element) => {
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

  // Mirror toggles in composer bar — sync back to setup-tab checkboxes
  const mirrorHandler = () => {
    if (!isInitialized) return;
    state.settings.showThoughts = els.showThoughtsMirror.checked;
    state.settings.toolsEnabled = els.toolsEnabledMirror.checked;
    els.showThoughts.checked = state.settings.showThoughts;
    els.toolsEnabled.checked = state.settings.toolsEnabled;
    saveState();
    renderTranscript();
    renderConversationSummary();
  };
  if (els.showThoughtsMirror) els.showThoughtsMirror.addEventListener("change", mirrorHandler);
  if (els.toolsEnabledMirror) els.toolsEnabledMirror.addEventListener("change", mirrorHandler);

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

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Escape — close search bar or stop generation
    if (e.key === "Escape") {
      const bar = document.getElementById("transcriptSearchBar");
      if (bar && bar.style.display !== "none") {
        e.preventDefault();
        hideTranscriptSearch();
        return;
      }
      // Stop generation if running
      if (getIsGenerating()) {
        e.preventDefault();
        stopGeneration();
        return;
      }
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Cmd/Ctrl+F — open transcript search
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      showTranscriptSearch();
      return;
    }

    // Cmd/Ctrl+Enter — send message or trigger next turn
    // Guard: don't fire when typing in a sidebar form field
    if (e.key === "Enter" && !e.shiftKey) {
      const focused = document.activeElement;
      const inSidebarInput = focused &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT") &&
        focused !== els.userInput;
      if (!inSidebarInput) {
        const content = els.userInput.value.trim();
        if (content) {
          e.preventDefault();
          els.composer.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        } else {
          e.preventDefault();
          runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
        }
      }
    }

    // Cmd/Ctrl+Shift+N — next AI turn
    if (e.key === "N" && e.shiftKey) {
      e.preventDefault();
      runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
    }

    // Cmd/Ctrl+Shift+R — run a round
    if (e.key === "R" && e.shiftKey) {
      e.preventDefault();
      runRound().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
    }
  });

  // Bare Space / Enter — run next turn when no input is focused and not busy
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key !== " " && e.key !== "Enter") return;
    const focused = document.activeElement;
    const inInput = focused &&
      (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" ||
       focused.tagName === "SELECT" || focused.isContentEditable);
    if (inInput) return;
    if (getIsGenerating()) return;
    e.preventDefault();
    runNextTurn().then(ok => { if (ok) saveCurrentSession().catch(console.warn); });
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
  els.clearConversation.addEventListener("click", confirmAndResetSession);
  els.copySession.addEventListener("click", copySessionToClipboard);
  els.stop.addEventListener("click", stopGeneration);
  els.generateQuickStart.addEventListener("click", generateQuickStart);
  els.applyQuickStart.addEventListener("click", () => applyQuickStartConfig());
  els.discardQuickStart.addEventListener("click", discardQuickStartConfig);
  els.addActor.addEventListener("click", () => addActor(false));
  els.addResearcher.addEventListener("click", () => addActor(true));
  document.getElementById("addActorFromDescBtn")?.addEventListener("click", generateActorFromDescription);
  document.querySelectorAll(".actor-template-btn").forEach(btn => {
    btn.addEventListener("click", () => addActorFromTemplate(btn.dataset.template));
  });
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

  // Listen for telemetry updates to refresh the dial
  document.addEventListener("telemetryUpdated", () => {
    renderTelemetry();
  });

  // Actor turn indicator — highlight the active speaker's card in the roster
  document.addEventListener("speakerChanged", ({ detail: { name } }) => {
    document.querySelectorAll(".actor-card").forEach(card => {
      const actor = state.actors.find(a => a.id === card.dataset.actorId);
      card.classList.toggle("is-speaking", !!name && !!actor && actor.name === name);
    });
    // DM section
    const dmSection = document.querySelector(".section--director");
    if (dmSection) {
      dmSection.classList.toggle("is-speaking", !!name && name === state.dm.name);
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
  } catch (err) {
    console.warn("Memory storage initialization failed, app continues:", err);
  }
  startConnectionPing();
}

startApp();
