import { describe, expect, it, vi } from 'vitest';
import { initSidebar } from '../frontend/js/sidebar.js';

// Small DOM fixture: exercise the real controller without adding a browser or
// DOM-emulation dependency to the offline test command.
function fixture({ mobile = false, collapsed = false, storageBlocked = false } = {}) {
  const document = { activeElement: null };
  function target() {
    const handlers = new Map();
    return {
      addEventListener(name, fn) { handlers.set(name, [...(handlers.get(name) || []), fn]); },
      emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event); },
    };
  }
  function element(id) {
    const classes = new Set();
    const attributes = new Map();
    return {
      ...target(), id, inert: false, hidden: false,
      classList: {
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      removeAttribute(name) { attributes.delete(name); },
      focus() { document.activeElement = this; },
      contains(node) { return node === this; },
      closest() { return null; },
    };
  }
  const ids = ['app', 'sidebar', 'main-content', 'sidebar-toggle', 'sidebar-close', 'sidebar-backdrop',
    'settings-btn', 'new-chat-btn', 'search-conversations'];
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const controls = ['new-chat-btn', 'sidebar-close', 'search-conversations', 'settings-btn'].map(id => elements[id]);
  elements.sidebar.contains = node => controls.includes(node) || node === elements.sidebar;
  elements.sidebar.querySelectorAll = () => controls;
  Object.assign(document, target(), { getElementById: id => elements[id] });
  const media = { ...target(), matches: mobile };
  const storage = {
    getItem: vi.fn(() => { if (storageBlocked) throw new Error('Storage disabled'); return String(collapsed); }),
    setItem: vi.fn(() => { if (storageBlocked) throw new Error('Storage disabled'); }),
  };
  const window = { matchMedia: () => media, localStorage: storage };
  const controller = initSidebar({ document, window });
  function key(key, options = {}) {
    const event = { key, target: elements['sidebar-toggle'], preventDefault: vi.fn(), ...options };
    document.emit('keydown', event);
    return event;
  }
  return { document, elements, storage, controller, key,
    click(id) { elements[id].emit('click'); },
    resize(matches) { media.matches = matches; media.emit('change'); },
  };
}

describe('Sidebar navigation', () => {
  it('restores the desktop preference and removes hidden controls from focus navigation', () => {
    const { elements, click, storage } = fixture({ collapsed: true });
    expect(elements.sidebar.inert).toBe(true);
    expect(elements['sidebar-toggle'].getAttribute('aria-expanded')).toBe('false');
    expect(elements.app.classList.contains('sidebar-collapsed')).toBe(true);
    click('sidebar-toggle');
    expect(elements.sidebar.inert).toBe(false);
    expect(elements['sidebar-toggle'].getAttribute('aria-expanded')).toBe('true');
    expect(storage.setItem).toHaveBeenCalledWith('phantom_sidebar_collapsed', 'false');
  });

  it('opens the mobile drawer with a backdrop, focus and modal semantics', () => {
    const { elements, click, document, storage } = fixture({ mobile: true });
    expect(elements.sidebar.inert).toBe(true);
    click('sidebar-toggle');
    expect(elements.sidebar.classList.contains('open')).toBe(true);
    expect(elements.sidebar.getAttribute('aria-modal')).toBe('true');
    expect(elements['sidebar-backdrop'].hidden).toBe(false);
    expect(elements['main-content'].inert).toBe(true);
    expect(document.activeElement).toBe(elements['search-conversations']);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['sidebar-close', 'sidebar-backdrop', 'settings-btn', 'sidebar-toggle'])(
    'closes the mobile drawer with %s and restores focus', id => {
      const { elements, click, document } = fixture({ mobile: true });
      click('sidebar-toggle');
      click(id);
      expect(elements.sidebar.inert).toBe(true);
      expect(elements['sidebar-backdrop'].hidden).toBe(true);
      expect(elements['main-content'].inert).toBe(false);
      expect(elements.sidebar.getAttribute('aria-modal')).toBeUndefined();
      expect(document.activeElement).toBe(elements['sidebar-toggle']);
    },
  );

  it('supports Escape and the programmatic navigation close action', () => {
    const { click, key, elements, controller } = fixture({ mobile: true });
    click('sidebar-toggle');
    expect(key('Escape').preventDefault).toHaveBeenCalled();
    expect(elements.sidebar.inert).toBe(true);
    click('sidebar-toggle');
    controller.closeMobile();
    expect(elements.sidebar.inert).toBe(true);
    expect(elements['main-content'].inert).toBe(false);
  });

  it('keeps Tab and Shift+Tab within the mobile drawer', () => {
    const { click, elements, key, document } = fixture({ mobile: true });
    click('sidebar-toggle');
    elements['settings-btn'].focus();
    expect(key('Tab').preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(elements['new-chat-btn']);
    expect(key('Tab', { shiftKey: true }).preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(elements['settings-btn']);
  });

  it('preserves desktop collapse state across mobile/desktop resizing', () => {
    const { elements, resize, click } = fixture({ collapsed: true });
    resize(true);
    click('sidebar-toggle');
    resize(false);
    expect(elements.sidebar.inert).toBe(true);
    expect(elements.app.classList.contains('sidebar-collapsed')).toBe(true);
    expect(elements['main-content'].inert).toBe(false);
    resize(true);
    expect(elements.sidebar.classList.contains('open')).toBe(false);
    expect(elements['sidebar-backdrop'].hidden).toBe(true);
  });

  it('restores an expanded desktop sidebar after closing the mobile drawer', () => {
    const { elements, resize, click } = fixture();
    resize(true);
    click('sidebar-toggle');
    resize(false);
    expect(elements.sidebar.inert).toBe(false);
    expect(elements['sidebar-toggle'].getAttribute('aria-expanded')).toBe('true');
    expect(elements['sidebar-backdrop'].hidden).toBe(true);
  });

  it('moves focus out of a newly collapsed sidebar', () => {
    const { click, elements, document } = fixture();
    elements['settings-btn'].focus();
    click('sidebar-toggle');
    expect(document.activeElement).toBe(elements['sidebar-toggle']);
  });

  it('supports Ctrl/Cmd+B without hijacking editing shortcuts', () => {
    const { key, elements } = fixture();
    expect(key('b', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(elements.sidebar.inert).toBe(true);
    expect(key('B', { metaKey: true }).preventDefault).toHaveBeenCalled();
    expect(elements.sidebar.inert).toBe(false);
    for (const options of [
      { target: { closest: () => ({}) } },
      { target: { isContentEditable: true } },
      { repeat: true }, { isComposing: true }, { altKey: true },
    ]) {
      expect(key('b', { ctrlKey: true, ...options }).preventDefault).not.toHaveBeenCalled();
      expect(elements.sidebar.inert).toBe(false);
    }
  });

  it('works when localStorage is unavailable', () => {
    const { click, elements } = fixture({ storageBlocked: true });
    expect(() => click('sidebar-toggle')).not.toThrow();
    expect(elements.sidebar.inert).toBe(true);
  });
});
