/** Keep desktop collapse preference separate from the temporary mobile drawer. */
export function initSidebar({ document, window }) {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main-content');
  const toggle = document.getElementById('sidebar-toggle');
  const close = document.getElementById('sidebar-close');
  const backdrop = document.getElementById('sidebar-backdrop');
  const media = window.matchMedia('(max-width: 768px)');
  let collapsed = false;
  let mobileOpen = false;
  try { collapsed = window.localStorage.getItem('phantom_sidebar_collapsed') === 'true'; } catch { /* Storage can be disabled. */ }

  function render() {
    const visible = media.matches ? mobileOpen : !collapsed;
    app.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.classList.toggle('open', media.matches && mobileOpen);
    sidebar.inert = !visible;
    sidebar.setAttribute('aria-hidden', String(!visible));
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Hide sidebar' : 'Show sidebar');
    toggle.title = visible ? 'Hide sidebar' : 'Show sidebar';
    backdrop.hidden = !(media.matches && mobileOpen);
    main.inert = media.matches && mobileOpen;
    if (media.matches && mobileOpen) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    if (!visible && sidebar.contains(document.activeElement)) toggle.focus();
  }

  function closeMobile({ restoreFocus = true } = {}) {
    if (!mobileOpen) return;
    mobileOpen = false;
    render();
    if (restoreFocus) toggle.focus();
  }

  function toggleSidebar() {
    if (media.matches) {
      mobileOpen = !mobileOpen;
      render();
      if (mobileOpen) document.getElementById('search-conversations').focus();
      else toggle.focus();
    } else {
      collapsed = !collapsed;
      try { window.localStorage.setItem('phantom_sidebar_collapsed', String(collapsed)); } catch { /* Keep working without persistence. */ }
      render();
    }
  }

  toggle.addEventListener('click', toggleSidebar);
  close.addEventListener('click', () => closeMobile());
  backdrop.addEventListener('click', () => closeMobile());
  // Close before Settings opens so its drawer is not competing with this one.
  document.getElementById('settings-btn').addEventListener('click', () => closeMobile());
  media.addEventListener('change', () => {
    mobileOpen = false;
    render();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'b') {
      if (event.repeat || event.target.isContentEditable || event.target.closest?.('input, textarea, select')) return;
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (!media.matches || !mobileOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobile();
    } else if (event.key === 'Tab') {
      const buttons = [...sidebar.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!sidebar.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  render();
  return { closeMobile };
}
