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
  switchSidebarTab,
  switchDocView,
  switchTab,
  isInitialized,
  setInitialized
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
  confirmAndResetSession,
  confirmAndFullReset,
  addActor,
  generateQuickStart,
  applyQuickStartConfig,
  discardQuickStartConfig
} from './modules/session.js';
import { initializeMemoryStorage, getAllChunks } from './modules/db.js';

// Wire the els reference into api.js so setStatus, loadModels, etc. can access DOM elements
initApi(els);

function wireEvents() {
  [
    els.baseUrl,
    els.apiKey,
    els.model,
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
    els.maxRounds,
    els.showThoughts,
    els.toolsEnabled
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

  // Sidebar tabs (Setup / Document)
  els.sidebarTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchSidebarTab(tab.dataset.sidebar));
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

  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  els.mobileNavBtns.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  els.tabJumps.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tabJump));
  });

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
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Cmd/Ctrl+Enter — send message or trigger next turn
    if (e.key === "Enter" && !e.shiftKey) {
      const activePanel = state.ui.activeTab;
      if (activePanel === "conversation") {
        const content = els.userInput.value.trim();
        if (content) {
          e.preventDefault();
          els.composer.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        } else {
          e.preventDefault();
          runNextTurn();
        }
      }
    }

    // Cmd/Ctrl+Shift+N — next AI turn
    if (e.key === "N" && e.shiftKey) {
      e.preventDefault();
      runNextTurn();
    }

    // Cmd/Ctrl+Shift+R — run a round
    if (e.key === "R" && e.shiftKey) {
      e.preventDefault();
      runRound();
    }
  });

  els.loadModels.addEventListener("click", loadModels);
  els.nextTurn.addEventListener("click", runNextTurn);
  els.round.addEventListener("click", () => runRound());
  els.auto.addEventListener("click", runAutoLoop);
  els.clearConversation.addEventListener("click", confirmAndResetSession);
  els.stop.addEventListener("click", stopGeneration);
  els.generateQuickStart.addEventListener("click", generateQuickStart);
  els.applyQuickStart.addEventListener("click", () => applyQuickStartConfig());
  els.discardQuickStart.addEventListener("click", discardQuickStartConfig);
  els.addActor.addEventListener("click", addActor);
  els.savePreset.addEventListener("click", savePreset);
  els.loadPreset.addEventListener("click", () => els.presetFile.click());
  els.exportSession.addEventListener("click", () => exportSession());
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
}

async function startApp() {
  wireEvents();
  restoreLastConnection();
  syncFormFromState();
  setInitialized(true);

  // On narrow screens, start with the summary collapsed
  if (window.matchMedia("(max-width: 1120px)").matches) {
    const collapse = document.querySelector(".summary-collapse");
    if (collapse) collapse.removeAttribute("open");
  }
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
