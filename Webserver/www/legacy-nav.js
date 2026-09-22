(function () {
  'use strict';

  var links = [
    ['Discover', '/LuckBlox.site.tk/games'],
    ['Avatar Shop', '/LuckBlox.site.tk/catalog'],
    ['Create', '/LuckBlox.site.tk/create'],
    ['Robux', '/LuckBlox.site.tk/robux'],
    ['Search', '/LuckBlox.site.tk/search'],
    ['Events', '/LuckBlox.site.tk/events'],
    ['Help', '/LuckBlox.site.tk/help'],
    ['Log In', '/LuckBlox.site.tk/signin'],
    ['Sign Up', '/LuckBlox.site.tk/signup']
  ];

  function renderLinks(nav) {
    nav.classList.add('legacy-global-nav');
    nav.innerHTML = links.map(function (link) {
      return '<a href="' + link[1] + '">' + link[0] + '</a>';
    }).join('');
  }

  function start() {
    var nav = document.querySelector('.topbar .nav, .topbar .site-nav, .roblox-nav-links');
    if (nav) {
      renderLinks(nav);
    }

    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'legacy-nav-bar legacy-global-nav';
      nav.setAttribute('aria-label', 'Main navigation');
      renderLinks(nav);
      document.body.insertBefore(nav, document.body.firstChild);
    }

    var sidebar = document.querySelector('.legacy-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.className = 'legacy-sidebar';
      sidebar.innerHTML = '<div class="legacy-sidebar-title">LuckyBlox</div>' +
        '<a href="/LuckBlox.site.tk/home">Home</a>' +
        '<a href="/LuckBlox.site.tk/games">Games</a>' +
        '<a href="/LuckBlox.site.tk/catalog">Catalog</a>' +
        '<a href="/LuckBlox.site.tk/avatar">Avatar</a>' +
        '<a href="/LuckBlox.site.tk/create">Create</a>' +
        '<a href="/LuckBlox.site.tk/users/1/profile">Profile</a>' +
        '<a href="/LuckBlox.site.tk/friends">Friends</a>' +
        '<a href="/LuckBlox.site.tk/messages">Messages</a>' +
        '<a href="/LuckBlox.site.tk/settings">Settings</a>' +
        '<a href="/LuckBlox.site.tk/help">Help</a>';
      document.body.insertBefore(sidebar, document.body.firstChild);
    }

    document.body.classList.add('legacy-shell');
    var currentPath = window.location.pathname.replace(/\/$/, '');
    sidebar.querySelectorAll('a').forEach(function (link) {
      var linkPath = new URL(link.href, window.location.href).pathname.replace(/\/$/, '');
      if (currentPath === linkPath || (linkPath && currentPath.indexOf(linkPath + '/') === 0)) {
        link.classList.add('active');
      }
    });

    if (!document.querySelector('script[src="/legacy-play.js"]')) {
      var playScript = document.createElement('script');
      playScript.src = '/legacy-play.js';
      document.body.appendChild(playScript);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
