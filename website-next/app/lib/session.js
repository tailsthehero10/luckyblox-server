/**
 * Session + CSRF helpers for the Next frontend.
 *
 * The Express bridge owns authentication. It does NOT expose a JSON signup
 * endpoint - account creation is `POST /signup`, which is guarded by CSRF: the
 * token is bound to the `luckblox_session` cookie the bridge issues on the page
 * response. A Next server action therefore has to do two things in order:
 *
 *   1. GET a page from the bridge so it hands back its guest session cookie and
 *      the CSRF token bound to it.
 *   2. POST the form carrying both the cookie and `_csrf`.
 *
 * Posting straight to /signup without that pair is rejected 403, which the old
 * site surfaced as a blank "security token invalid" page.
 */

const BACKEND = process.env.LUCKYBLOX_BACKEND_URL || 'http://127.0.0.1:3002';

/**
 * Start a guest session with the bridge and return its cookie + CSRF token.
 *
 * The token is read from the signup page markup (`name="_csrf" value="..."`),
 * which is the only place the bridge publishes it for a form.
 */
export async function beginGuestSession() {
  const response = await fetch(`${BACKEND}/signup`, {
    cache: 'no-store',
    headers: { accept: 'text/html' },
  });

  const html = await response.text();

  // Node's fetch folds multiple Set-Cookie headers into one comma-joined value;
  // keep only the cookie pair we need.
  const rawCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie().join('; ')
    : (response.headers.get('set-cookie') || '');
  const sessionCookie = (rawCookie.match(/luckblox_session=[^;,\s]+/) || [])[0] || '';

  const tokenMatch = html.match(/name="_csrf"\s+value="([^"]*)"/);
  const csrfToken = tokenMatch ? tokenMatch[1] : '';

  return { sessionCookie, csrfToken };
}

/**
 * Create an account through the bridge's real /signup endpoint.
 *
 * Field names match the bridge (`confirmPassword`, not hexium's
 * `passwordConfirm`); `birthday`, `gender` and `discordUserId` are accepted and
 * forwarded because the reference signup form collects them.
 */
export async function createAccount({ username, password, confirmPassword, birthday, gender, discordUserId }) {
  const { sessionCookie, csrfToken } = await beginGuestSession();

  if (!csrfToken) {
    return { ok: false, message: 'Could not start a secure session with the game service.' };
  }

  const body = new URLSearchParams({
    username,
    password,
    confirmPassword,
    birthday: birthday || '',
    gender: gender || '',
    discordUserId: discordUserId || '',
    _csrf: csrfToken,
  });

  const response = await fetch(`${BACKEND}/signup`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: sessionCookie,
    },
    body,
  });

  // The bridge redirects on success and RE-RENDERS the form with a message on
  // failure, so success is a 3xx - not a 200.
  if (response.status >= 300 && response.status < 400) {
    return { ok: true, message: 'Account created.' };
  }

  const html = await response.text();
  const message = extractError(html) || `Signup failed (HTTP ${response.status}).`;
  return { ok: false, message };
}

/** Pull the error message out of the bridge's re-rendered signup page. */
function extractError(html) {
  const match = html.match(/class="[^"]*(?:error|alert)[^"]*"[^>]*>([\s\S]{0,300}?)</i);
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Sign in through the bridge's JSON endpoint.
 *
 * `POST /api/login` returns JSON and sets the session cookie; it is not a form
 * route, so no CSRF token is required.
 */
export async function signIn({ username, password }) {
  try {
    const response = await fetch(`${BACKEND}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      return { ok: false, message: body.message || 'Incorrect username or password.' };
    }
    return { ok: true, user: body.user || null };
  } catch (error) {
    return { ok: false, message: 'The game service is unreachable.' };
  }
}