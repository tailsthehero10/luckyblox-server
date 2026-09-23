(function () {
  'use strict';

  var links = [
    ['Discover', '/games'],
    ['Avatar Shop', '/catalog'],
    ['Create', '/develop'],
    ['Robux', '/robux'],
    ['Search', '/games'],
    ['Events', '/events'],
    ['Help', '/help'],
    ['Log In', '/signin'],
    ['Sign Up', '/signup']
  ];

  function renderLinks(nav) {
    nav.classList.add('legacy-global-nav');
    nav.innerHTML = links.map(function (link) {
      return '<a href="' + link[1] + '">' + link[0] + '</a>';
    }).join('');
  }

  /**
   * Live site-status block in the sidebar. Reads /api/site-status so the sidebar
   * always shows the real current state (open / work in progress / maintenance /
   * closed) and links through to /sitestat. Failures are shown plainly — the
   * block never invents a status it could not read.
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

  function start() {
    var nav = document.querySelector('.roblox-nav-links, .roblox-nav');
    if (nav) renderLinks(nav);

    var sidebar = document.querySelector('.legacy-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.className = 'legacy-sidebar';
      sidebar.innerHTML = '<div class="legacy-sidebar-title">LuckyBlox</div>' +
        '<a href="/home">Home</a><a href="/games">Games</a><a href="/catalog">Catalog</a>' +
        '<a href="/avatar">Avatar</a><a href="/develop">Create</a><a href="/profile">Profile</a>' +
        '<a href="/friends">Friends</a><a href="/groups">Groups</a><a href="/messages">Messages</a>' +
        '<a href="/settings">Settings</a>' +
        '<a href="/signin">Log In</a><a href="/signup">Sign Up</a>';
      document.body.insertBefore(sidebar, document.body.firstChild);
    }

    renderStatus(sidebar);

    document.body.classList.add('legacy-shell');
    var currentPath = window.location.pathname.replace(/\/$/, '');
    sidebar.querySelectorAll('a').forEach(function (link) {
      var linkPath = new URL(link.href, window.location.href).pathname.replace(/\/$/, '');
      if (currentPath === linkPath || (linkPath && currentPath.indexOf(linkPath + '/') === 0)) {
        link.classList.add('active');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
