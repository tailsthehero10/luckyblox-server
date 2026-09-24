(function () {
  'use strict';

  /**
   * Shared header behaviour for every page.
   *
   * This file used to overwrite the page nav with a hardcoded list that included
   * routes the server does not implement (/robux, /events, /help, /groups,
   * /messages, /settings), and injected a second sidebar into the body of every
   * page - which is why the navigation looked like it was "everywhere" and some
   * buttons did nothing. It now only:
   *
   *   1. builds the nav from links that actually resolve to a real route,
   *   2. keeps the live site-status block inside a sidebar the page already has,
   *   3. refreshes the Robux figure from the account so it is live, not frozen.
   *
   * Nothing is injected into the body any more.
   */
  var links = [
    ['Discover', '/games'],
    ['Avatar', '/avatar'],
    ['Create', '/develop'],
    ['Studio', '/studio']
  ];

  function renderLinks(nav) {
    if (!nav) return;

    var target = nav.classList.contains('roblox-nav-links')
      ? nav
      : (nav.querySelector('.roblox-nav-links') || nav);

    target.innerHTML = links.map(function (link) {
      return '<a href="' + link[1] + '">' + link[0] + '</a>';
    }).join('');

    markActive(target);
  }

  function markActive(scope) {
    var currentPath = window.location.pathname.replace(/\/$/, '');
    scope.querySelectorAll('a').forEach(function (link) {
      var linkPath = new URL(link.getAttribute('href'), window.location.href).pathname.replace(/\/$/, '');
      if (!linkPath) return;
      if (currentPath === linkPath || (linkPath !== '/' && currentPath.indexOf(linkPath + '/') === 0)) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  /**
   * Live site-status block, added only to a sidebar the page already has. Pages
   * without a sidebar (sign-in, sign-up, game pages) are left untouched, so this
   * no longer appears everywhere.
   */
  function renderStatus(sidebar) {
    if (!sidebar || sidebar.querySelector('.legacy-site-status')) return;

    var block = document.createElement('a');
    block.className = 'legacy-site-status';
    block.href = '/sitestat';
    block.innerHTML = '<span class="legacy-site-status-label">Site status</span>' +
      '<span class="legacy-site-status-value">' +
      '<span class="legacy-site-status-dot"></span>' +
      '<span class="legacy-site-status-text">Checking\u2026</span>' +
      '</span>' +
      '<span class="legacy-site-status-detail"></span>';

    var title = sidebar.querySelector('.legacy-sidebar-title');
    if (title && title.parentNode === sidebar) {
      title.insertAdjacentElement('afterend', block);
    } else {
      sidebar.insertBefore(block, sidebar.firstChild);
    }

    var dot = block.querySelector('.legacy-site-status-dot');
    var text = block.querySelector('.legacy-site-status-text');
    var detail = block.querySelector('.legacy-site-status-detail');

    fetch('/api/site-status', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('status ' + r.status)); })
      .then(function (data) {
        text.textContent = data.label || (data.open ? 'Open' : 'Closed');
        detail.textContent = data.open
          ? 'Everything is running normally.'
          : (data.detail || 'The site is closed right now.');
        dot.className = 'legacy-site-status-dot' + (data.open ? ' is-open' : '');
        block.setAttribute('data-status', data.status || '');
      })
      .catch(function () {
        text.textContent = 'Status unavailable';
        detail.textContent = 'Could not read the site status.';
      });
  }

  /**
   * Replace the rendered Robux figure with the live value from the account. The
   * number is server-rendered as a first paint, then corrected here, so it is
   * never a hardcoded constant that ignores the account.
   */
  function refreshRobux() {
    var el = document.querySelector('.roblox-robux');
    if (!el) return;

    fetch('/api/me', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('status ' + r.status)); })
      .then(function (data) {
        if (!data || !data.ok || !data.user) return;
        var robux = Number(data.user.robux);
        if (!Number.isFinite(robux)) return;
        el.textContent = robux.toLocaleString();
        el.setAttribute('title', 'R$ ' + robux.toLocaleString());
      })
      .catch(function () {
        /* leave the server-rendered value in place rather than inventing one */
      });
  }

  function start() {
    // The pages now render their own complete nav (Home / Games / Create / More)
    // and the home page renders a real sidebar, so this script no longer rewrites
    // or injects navigation. It only keeps the live status block and the Robux
    // figure fresh. Rewriting the nav here is what previously clobbered the
    // "More pages" dropdown.
    renderStatus(document.querySelector('.legacy-sidebar, .roblox-sidebar'));
    refreshRobux();

    var sidebar = document.querySelector('.legacy-sidebar');
    if (sidebar) {
      document.body.classList.add('legacy-shell');
      markActive(sidebar);
    }
    markActive(document.querySelector('.roblox-sidebar') || document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
