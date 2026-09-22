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
        '<a href="/friends">Friends</a><a href="/messages">Messages</a><a href="/settings">Settings</a>' +
        '<a href="/signin">Log In</a><a href="/signup">Sign Up</a>';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
