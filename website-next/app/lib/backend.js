/**
 * Backend access.
 *
 * The Express bridge remains the ONLY source of game data. This module reads
 * from it; it never reimplements the data layer. If the bridge is not running
 * the page says so plainly instead of rendering invented content.
 */

const BACKEND = process.env.LUCKYBLOX_BACKEND_URL || 'http://127.0.0.1:3002';

/** Normalise one game record from /api/games into the shape the UI renders. */
function toCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const placeId = Number(raw.placeId);
  if (!Number.isSafeInteger(placeId) || placeId <= 0) return null;
  return {
    placeId,
    title: String(raw.title || raw.name || `Experience ${placeId}`),
    icon: typeof raw.icon === 'string' && /^\/|^https?:\/\//.test(raw.icon)
      ? raw.icon
      : '/gameplaceholder/card.png',
    // The era the game runs on. Null when the backend does not report one, so
    // the card omits it rather than showing a made-up year.
    clientYear: Number.isFinite(Number(raw.clientYear)) ? Number(raw.clientYear) : null,
    playing: Number(raw.playerCount) || 0,
  };
}

/**
 * Fetch the game list.
 *
 * Returns `{ games, error }`. A backend that is down yields an empty list plus
 * a message - never fabricated games.
 */
export async function fetchGames() {
  try {
    const response = await fetch(`${BACKEND}/api/games`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      return { games: [], error: `The game service answered HTTP ${response.status}.` };
    }

    const body = await response.json();
    const list = Array.isArray(body && body.games) ? body.games : [];
    const games = list.map(toCard).filter(Boolean);

    return { games, error: null };
  } catch (error) {
    return {
      games: [],
      error: `The game service is unreachable at ${BACKEND}.`,
    };
  }
}