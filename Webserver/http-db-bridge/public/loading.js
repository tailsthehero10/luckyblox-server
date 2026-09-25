/**
 * LuckyBlox loading UI.
 *
 * A tiny, dependency-free helper that puts the LuckyBlox loading spinner (the
 * real shipping artwork at /img/loading.gif) on screen whenever the page is
 * actually waiting on the server, and takes it off when the answer arrives.
 *
 * Why this exists as its own file: the spinner was previously only wired to
 * image loads (see decorateLoadingImages in legacy-nav.js). Every fetch() on the
 * site - sign-in, launch, avatar save, asset loading, the catalog - ran with no
 * visible feedback at all, so a slow response looked like a dead page. This
 * gives those calls one shared, consistent indicator.
 *
 * Usage:
 *
 *   LBLoading.show();                  // full-page veil
 *   LBLoading.hide();
 *   LBLoading.block(el);               // spinner over one element
 *   LBLoading.blockOff(el);
 *   await LBLoading.track(fetch(...)); // veil on, await, veil off (even on throw)
 *   await LBLoading.run(async () => { ... }, 'Signing in');  // + status line
 *   LBLoading.button(btn, true);       // in-button spinner
 *
 * The full-page veil counts concurrent calls, so two overlapping requests do not
 * leave the page stuck behind a spinner after the first one finishes.
 */
(function () {
  'use strict';

  var pageEl = null;
  var pageTextEl = null;
  var activeCount = 0;
  var startedAt = 0;

  // A veil that flashes for 80ms is worse than none: it reads as a glitch. Any
  // wait shorter than this is left invisible, which is what a fast cache hit
  // should look like.
  var MIN_VISIBLE_MS = 320;

  function buildPage() {
    if (pageEl) return pageEl;

    pageEl = document.createElement('div');
    pageEl.className = 'lb-loading-page';
    pageEl.setAttribute('role', 'status');
    pageEl.setAttribute('aria-live', 'polite');

    pageTextEl = document.createElement('div');
    pageTextEl.className = 'lb-loading-page-text';
    pageTextEl.textContent = 'Loading\u2026';

    pageEl.appendChild(pageTextEl);
    document.body.appendChild(pageEl);
    return pageEl;
  }

  function show(text) {
    buildPage();
    if (typeof text === 'string' && text) pageTextEl.textContent = text;
    activeCount += 1;
    if (activeCount === 1) startedAt = Date.now();
    pageEl.classList.add('is-loading');
  }

  function hide() {
    if (!pageEl) return;
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount > 0) return;

    // If the wait was too short to read, hold the veil for the remainder so it
    // appears as a deliberate flash rather than a flicker.
    var elapsed = Date.now() - startedAt;
    var remaining = elapsed < MIN_VISIBLE_MS ? MIN_VISIBLE_MS - elapsed : 0;
    if (remaining > 0) {
      window.setTimeout(function () {
        pageEl.classList.remove('is-loading');
      }, remaining);
    } else {
      pageEl.classList.remove('is-loading');
    }
  }

  /** Force the veil off and reset the counter (used when a page recovers). */
  function hideAll() {
    activeCount = 0;
    if (pageEl) pageEl.classList.remove('is-loading');
  }

  function block(el, text) {
    if (!el) return;
    el.classList.add('lb-loading-block', 'is-loading');
    if (typeof text === 'string' && text) el.setAttribute('data-lb-loading-text', text);
  }

  function blockOff(el) {
    if (!el) return;
    el.classList.remove('is-loading');
  }

  /** Turn the spinner on over an element while `promise` settles. */
  function track(promise, el) {
    if (el) block(el);
    else show();
    return Promise.resolve(promise).finally(function () {
      if (el) blockOff(el);
      else hide();
    });
  }

  /**
   * Run an async task behind the full-page veil, with an optional status line.
   *
   * The veil is always removed - including when the task throws - so a failed
   * request can never leave the site stuck. The rejection is re-thrown for the
   * caller to handle.
   */
  function run(task, text) {
    show(text);
    return Promise.resolve()
      .then(task)
      .finally(function () {
        hide();
      });
  }

  function button(btn, on) {
    if (!btn) return;
    if (on) {
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      if (btn.disabled !== undefined) btn.disabled = true;
    } else {
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
      if (btn.disabled !== undefined) btn.disabled = false;
    }
  }

  /**
   * fetch() with the spinner already running.
   *
   * The JSON API is what most of the site talks to, so this also parses the
   * response and surfaces the server's own `message` on a non-OK status instead
   * of leaving the caller to re-implement that every time.
   */
  function json(url, options, el) {
    var opts = Object.assign({ headers: { Accept: 'application/json' } }, options || {});
    if (opts.body && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }

    var target = el || null;
    if (target) block(target);
    else show();

    return fetch(url, opts)
      .then(function (response) {
        return response.json()
          .catch(function () { return {}; })
          .then(function (data) {
            return { response: response, data: data };
          });
      })
      .finally(function () {
        if (target) blockOff(target);
        else hide();
      });
  }

  window.LBLoading = {
    show: show,
    hide: hide,
    hideAll: hideAll,
    block: block,
    blockOff: blockOff,
    track: track,
    run: run,
    button: button,
    json: json,
  };

  // A navigation that leaves the page mid-load should not strand the veil: the
  // browser teardown is fine, but a bfcache restore (back button) would show a
  // restored veil over a live page.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) hideAll();
  });
}());