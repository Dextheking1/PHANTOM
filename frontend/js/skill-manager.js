/** Lightweight shell for the API-backed skill list. */
export function renderSkillManager(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<p class="tab-desc">Installed skills appear here after the workspace is loaded.</p>';
}
