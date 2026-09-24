/**
 * LuckyBlox custom dropdown.
 *
 * Progressive enhancement: any <select class="lb-select"> is replaced by a
 * styled, fully keyboard-accessible custom listbox. The real <select> stays in
 * the DOM (hidden) so forms keep submitting the right value and existing JS
 * that reads/writes .value keeps working.
 *
 * Why it is not glitchy:
 *   - one document-level pointerdown handler closes any open menu, instead of a
 *     window click listener that fought the button's own click;
 *   - the menu is positioned with position:fixed and clamped to the viewport, so
 *     it can never be clipped by a scrolling card or overflow:hidden;
 *   - it re-measures on scroll/resize and closes if the trigger leaves view;
 *   - typeahead, Home/End, Up/Down, Enter, Escape are all handled.
 */
(function () {
  'use strict';

  var openInstance = null;

  function buildOption(opt, selectValue, onPick) {
    var li = document.createElement('li');
    li.className = 'lb-select-option';
    li.setAttribute('role', 'option');
    li.dataset.value = opt.value;
    li.textContent = opt.textContent;
    if (opt.value === selectValue) {
      li.classList.add('is-selected');
      li.setAttribute('aria-selected', 'true');
    }
    li.addEventListener('click', function (e) {
      e.stopPropagation();
      onPick(opt.value);
    });
    return li;
  }

  function enhance(select) {
    if (select.dataset.lbEnhanced) return;
    select.dataset.lbEnhanced = '1';

    var wrap = document.createElement('div');
    // NOTE: the wrapper is NOT classed "lb-select". That name is used elsewhere
    // for a plain native <select> (height/min-width/padding on the element), and
    // sharing it made the wrapper inherit `min-width: 180px`, which broke any
    // grid the control sat in (the signup birthday row overflowed its card).
    wrap.className = 'lb-select-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('lb-select-native');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lb-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var label = document.createElement('span');
    label.className = 'lb-select-value';

    var arrow = document.createElement('span');
    arrow.className = 'lb-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 12 8" width="12" height="8"><path fill="currentColor" d="M1 1h10L6 7z"/></svg>';

    trigger.appendChild(label);
    trigger.appendChild(arrow);
    wrap.appendChild(trigger);

    var menu = document.createElement('ul');
    menu.className = 'lb-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    function selectedText() {
      var opt = select.options[select.selectedIndex];
      return opt ? opt.textContent : '';
    }

    function syncLabel() {
      var text = selectedText();
      label.textContent = text;
      var placeholder = select.selectedIndex <= 0 && (select.options[0] && select.options[0].disabled || select.options[0] && select.options[0].value === '');
      trigger.classList.toggle('is-placeholder', !!placeholder);
    }

    function rebuild() {
      menu.innerHTML = '';
      Array.prototype.forEach.call(select.options, function (opt) {
        if (opt.disabled) return;
        menu.appendChild(buildOption(opt, select.value, pick));
      });
      syncLabel();
    }

    function pick(value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncLabel();
      close();
      trigger.focus();
    }

    function position() {
      var rect = trigger.getBoundingClientRect();
      var spaceBelow = window.innerHeight - rect.bottom;
      var menuHeight = Math.min(menu.scrollHeight || 240, 260);
      var openUp = spaceBelow < menuHeight + 12 && rect.top > spaceBelow;
      menu.style.minWidth = rect.width + 'px';
      menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) + 'px';
      if (openUp) {
        menu.style.top = Math.max(8, rect.top - menuHeight - 6) + 'px';
      } else {
        menu.style.top = (rect.bottom + 6) + 'px';
      }
    }

    function open() {
      if (openInstance && openInstance !== api) openInstance.close();
      rebuild();
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      position();
      openInstance = api;
      var sel = menu.querySelector('.is-selected') || menu.firstElementChild;
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function close() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (openInstance === api) openInstance = null;
    }

    function isOpen() {
      return !menu.hidden;
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    });

    // Keyboard support mirrors a native select.
    trigger.addEventListener('keydown', function (e) {
      var idx = select.selectedIndex;
      var last = select.options.length - 1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) { open(); return; }
        idx = e.key === 'ArrowDown' ? Math.min(last, idx + 1) : Math.max(0, idx - 1);
        select.selectedIndex = idx;
        syncLabel();
        menu.querySelectorAll('.lb-select-option').forEach(function (li) {
          li.classList.toggle('is-selected', li.dataset.value === select.value);
        });
        var active = menu.querySelector('.is-selected');
        if (active) active.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isOpen()) { open(); return; }
        pick(select.value);
      } else if (e.key === 'Escape') {
        if (isOpen()) { e.preventDefault(); close(); }
      } else if (e.key === 'Home') {
        if (isOpen()) { e.preventDefault(); select.selectedIndex = 0; syncLabel(); }
      } else if (e.key === 'End') {
        if (isOpen()) { e.preventDefault(); select.selectedIndex = last; syncLabel(); }
      } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
        // typeahead
        var ch = e.key.toLowerCase();
        var opts = select.options;
        for (var i = 1; i <= opts.length; i++) {
          var candidate = opts[(idx + i) % opts.length];
          if (candidate && candidate.textContent.toLowerCase().indexOf(ch) === 0) {
            select.selectedIndex = (idx + i) % opts.length;
            syncLabel();
            break;
          }
        }
      }
    });

    window.addEventListener('resize', function () { if (isOpen()) position(); });
    window.addEventListener('scroll', function () { if (isOpen()) position(); }, true);

    var api = { close: close, open: open, trigger: trigger };
    wrap._lbSelect = api;
    rebuild();
  }

  // One handler for the whole document: clicking outside any open dropdown closes
  // it. Nothing else needs to stop propagation, so no double-toggle glitches.
  document.addEventListener('pointerdown', function (e) {
    if (!openInstance) return;
    if (openInstance.trigger.contains(e.target)) return;
    var menu = openInstance.trigger.parentNode.querySelector('.lb-select-menu');
    if (menu && menu.contains(e.target)) return;
    openInstance.close();
  });

  function enhanceAll(root) {
    (root || document).querySelectorAll('select.lb-select:not([data-lb-enhanced])').forEach(enhance);
  }

  /**
   * Make sure the dropdown stylesheet is present.
   *
   * The custom trigger and menu are entirely class-driven, so a page that loads
   * this script but forgets <link href="/css/lb-select.css"> gets an unstyled,
   * half-broken control (that is exactly what happened on the catalog and group
   * pages). Injecting it here means the only thing a page must include is this
   * one script tag.
   */
  function ensureStylesheet() {
    var href = '/css/lb-select.css';
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var attr = links[i].getAttribute('href') || '';
      if (attr.indexOf('lb-select.css') !== -1) return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  window.LBSelect = { enhanceAll: enhanceAll, enhance: enhance };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { ensureStylesheet(); enhanceAll(); });
  } else {
    ensureStylesheet();
    enhanceAll();
  }
}());