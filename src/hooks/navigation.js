// Lightweight cross-panel navigation. Panels are rendered deep inside the
// Inspector and don't receive setActivePanel, so they request a jump by
// dispatching a window event that App listens for. Keeps panels decoupled
// from the shell without prop-drilling or a context provider.
export const NAVIGATE_EVENT = 'forum:navigate';

export function navigateToPanel(panel) {
  if (!panel) return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { panel } }));
}
