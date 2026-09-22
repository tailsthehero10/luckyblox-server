(function () {
  'use strict';

  function isPlayLink(link) {
    if (!link || !link.href) return false;
    var url = new URL(link.href, window.location.href);
    return /\/LuckBlox\.site\.tk\/play\/?$/i.test(url.pathname) && url.searchParams.has('placeid');
  }

  async function launch(link) {
    var url = new URL(link.href, window.location.href);
    var placeId = url.searchParams.get('placeid');
    var original = link.textContent;
    link.setAttribute('aria-busy', 'true');
    link.textContent = 'Starting...';

    try {
      var response = await fetch('/api/launch.php?client=2021m&placeid=' + encodeURIComponent(placeId), {
        headers: { 'Accept': 'application/json' }
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok || !payload.playUrl) {
        throw new Error(payload.message || payload.error || 'Unable to start the local game server.');
      }
      window.location.href = payload.playUrl;
    } catch (error) {
      link.removeAttribute('aria-busy');
      link.textContent = original;
      window.alert(error.message || 'Unable to start the local game server.');
    }
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (!isPlayLink(link)) return;
    event.preventDefault();
    launch(link);
  });
}());
