/*
 * 2021.js - behaviour for the classic (2021) pages.
 *
 * The archived 2021 pages were an AngularJS single-page app. The LuckyBlox
 * rebuild renders the same DOM server-side, so this file only supplies the
 * interactive parts that actually do something:
 *
 *   1. the tab strip (the 2021 page used #! tab routes, so tabs are links)
 *   2. the character scale sliders, which preview and persist to the account
 *   3. the "Currently Wearing" toggle, which equips/unequips a real asset
 *
 * Every action talks to a LuckyBlox endpoint and then reloads real server data.
 * Nothing here fakes a result.
 */
(function () {
  'use strict';

  function profileData() {
    var el = document.getElementById('lb-profile-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (error) {
      return null;
    }
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="lb-csrf"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // --- 1. Tab strip ------------------------------------------------------
  // The 2021 profile used #!/about and #!/creations. Preserve that: switching a
  // tab updates the hash so a shared link opens the same tab, without a reload.
  function initTabs() {
    var tabs = document.querySelectorAll('[data-lb-tab]');
    if (!tabs.length) return;

    function activate(name) {
      tabs.forEach(function (tab) {
        var match = tab.getAttribute('data-lb-tab') === name;
        tab.classList.toggle('active', match);
        tab.setAttribute('aria-selected', match ? 'true' : 'false');
      });
      document.querySelectorAll('[data-lb-pane]').forEach(function (pane) {
        pane.hidden = pane.getAttribute('data-lb-pane') !== name;
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        event.preventDefault();
        var name = tab.getAttribute('data-lb-tab');
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#!/' + name);
        }
        activate(name);
      });
    });

    var initial = (window.location.hash || '').replace(/^#!?\/*/, '');
    activate(initial === 'creations' ? 'creations' : 'about');
  }

  // --- 2. Character scale sliders ---------------------------------------
  // The six real 2021 sliders (height / width / head / depth / proportion /
  // bodyType) each run 0-100 in the page. Saving posts the whole set so the
  // stored scales always match what the sliders show.
  function initScales() {
    var sliders = document.querySelectorAll('[data-lb-scale]');
    if (!sliders.length) return;

    var status = document.getElementById('lb-scale-status');
    var timer = null;

    function collect() {
      var scales = {};
      sliders.forEach(function (slider) {
        scales[slider.getAttribute('data-lb-scale')] = Number(slider.value) / 100;
      });
      return scales;
    }

    function save() {
      var data = profileData();
      if (!data) return;

      if (status) status.textContent = 'Saving character...';

      var body = 'userId=' + encodeURIComponent(data.userId)
        + '&csrf=' + encodeURIComponent(csrfToken())
        + '&scales=' + encodeURIComponent(JSON.stringify(collect()));

      fetch('/LuckBlox.site/api/avatar-save.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (status) {
            status.textContent = result && result.ok ? 'Character saved.' : 'Could not save character.';
          }
        })
        .catch(function () {
          if (status) status.textContent = 'Could not save character.';
        });
    }

    sliders.forEach(function (slider) {
      slider.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(save, 600);
      });
    });
  }

  // --- 3. Equip / unequip ------------------------------------------------
  // Item cards carry their asset id; clicking "Wearing" toggles the real
  // equipped list on the account through the existing avatar-save endpoint,
  // which takes the whole new `wearing` list.
  function initWearToggle() {
    var data = profileData();
    if (!data || !data.isProfileOwner) return;

    document.querySelectorAll('[data-lb-asset-id]').forEach(function (card) {
      var button = card.querySelector('.lb-wear-toggle');
      if (!button) return;

      button.addEventListener('click', function (event) {
        event.preventDefault();
        var assetId = card.getAttribute('data-lb-asset-id');
        var wearing = data.wearing.slice();

        var index = wearing.indexOf(assetId);
        if (index === -1) {
          wearing.push(assetId);
        } else {
          wearing.splice(index, 1);
        }

        button.disabled = true;

        var body = 'userId=' + encodeURIComponent(data.userId)
          + '&csrf=' + encodeURIComponent(csrfToken())
          + '&wearing=' + encodeURIComponent(JSON.stringify(wearing));

        fetch('/LuckBlox.site/api/avatar-save.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body,
        })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            if (result && result.ok) {
              window.location.reload();
              return;
            }
            button.disabled = false;
          })
          .catch(function () {
            button.disabled = false;
          });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initTabs();
      initScales();
      initWearToggle();
    });
  } else {
    initTabs();
    initScales();
    initWearToggle();
  }
}());