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
   * Live site-status block. Only injected into a sidebar that explicitly opts in
   * with data-show-status="1".
   *
   * It used to be added to every sidebar, which put a green "SITE STATUS / Open"
   * panel at the top of the profile and the games pages - something roblox.com
   * never had there, and which pushed the real content down. Pages that want it
   * (the status page itself, the owner panel) opt in.
   */
  function renderStatus(sidebar) {
    if (!sidebar || sidebar.querySelector('.legacy-site-status')) return;
    if (sidebar.getAttribute('data-show-status') !== '1') return;

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

  /**
   * Show Roblox's loading spinner over remote images until they finish loading.
   *
   * The spinner is served from this server (/img/loading.gif, saved locally from
   * images.rbxcdn.com) so it works offline and does not depend on the CDN. Only
   * remote images are wrapped - local placeholder art is already instant, and a
   * spinner over it would just flicker.
   *
   * A loading class is used rather than a per-image overlay element, so this
   * changes nothing about the existing markup or layout.
   */
  function decorateLoadingImages() {
    var images = document.querySelectorAll('img[loading="lazy"], img[src^="http"]');

    images.forEach(function (img) {
      // Already handled, or nothing to wait for.
      if (img.getAttribute('data-lb-loader') === '1') return;
      if (!img.complete && !img.currentSrc) {
        img.setAttribute('data-lb-loader', '1');
      } else if (img.complete) {
        return;
      } else {
        img.setAttribute('data-lb-loader', '1');
      }

      var host = img.parentNode;
      if (host) {
        host.classList.add('lb-loading-block', 'is-loading');
      }

      var clear = function () {
        if (host) host.classList.remove('is-loading');
        img.removeAttribute('data-lb-loader');
      };

      img.addEventListener('load', clear, { once: true });
      // On error the placeholder/onerror handling takes over; just drop the spinner.
      img.addEventListener('error', clear, { once: true });

      // A cached image may have completed between the check above and now.
      if (img.complete) clear();
    });
  }

  /**
   * "More pages" dropdown.
   *
   * It was CSS-only (:hover / :focus-within). That works with a mouse, but a
   * touch tap on the button does nothing, and — because the button sits inside
   * .roblox-nav, which the rail layout now hides — it also disappears entirely
   * if the whole nav is hidden. This binds a real click toggle so the menu opens
   * on any input, closes on outside-click and on Escape, and stays put when the
   * nav's bare links are hidden by CSS.
   */
  function bindMorePages() {
    var wrappers = document.querySelectorAll('.roblox-more-pages');

    wrappers.forEach(function (wrap) {
      if (wrap.getAttribute('data-lb-bound') === '1') return;
      wrap.setAttribute('data-lb-bound', '1');

      var btn = wrap.querySelector('.roblox-more-pages-btn');
      var menu = wrap.querySelector('.roblox-more-pages-dropdown');
      if (!btn || !menu) return;

      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var open = wrap.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      // A click on a link inside the menu should act like a normal navigation,
      // then the menu can go away.
      menu.addEventListener('click', function () {
        wrap.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });

    if (document.documentElement.getAttribute('data-lb-more-bound') === '1') return;
    document.documentElement.setAttribute('data-lb-more-bound', '1');

    document.addEventListener('click', function (e) {
      document.querySelectorAll('.roblox-more-pages.is-open').forEach(function (wrap) {
        if (wrap.contains(e.target)) return;
        wrap.classList.remove('is-open');
        var b = wrap.querySelector('.roblox-more-pages-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.roblox-more-pages.is-open').forEach(function (wrap) {
        wrap.classList.remove('is-open');
        var b = wrap.querySelector('.roblox-more-pages-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /**
   * The account menu in the top bar.
   *
   * A real click toggle rather than a CSS :hover menu, so it opens for a keyboard
   * user and a touch tap as well as a mouse, and closes on Escape and on an
   * outside click. Without this the signed-in visitor has no way to sign out.
   */
  function bindAccountMenu() {
    var wrap = document.querySelector('.lb-account-menu');
    if (!wrap) return;
    if (wrap.getAttribute('data-lb-bound') === '1') return;
    wrap.setAttribute('data-lb-bound', '1');

    var btn = document.getElementById('accountMenuBtn');
    var panel = document.getElementById('accountMenuPanel');
    if (!btn || !panel) return;

    function close() {
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = wrap.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // An outside click closes it. Using one document listener rather than a
    // full-screen backdrop keeps this from swallowing clicks on the page.
    document.addEventListener('click', function (e) {
      if (wrap.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
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
    decorateLoadingImages();
    bindMorePages();
    bindAccountMenu();

    // Images that arrive after the first paint (lazy ones scrolling into view)
    // still get the spinner.
    if (window.MutationObserver) {
      var pending = null;
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = window.setTimeout(function () {
          pending = null;
          decorateLoadingImages();
        }, 120);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

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
