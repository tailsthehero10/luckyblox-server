const { execSync } = require('child_process');

const ROBLOX_PROFILE_TEMPLATE_URL = 'https://www.roblox.com/users/998796/profile#!#creations';

const FALLBACK_TEMPLATE_ITEMS = [
  { placeId: 379736082, title: 'Starting Place' },
  { placeId: 366120910, title: 'Western' },
  { placeId: 366130569, title: 'Suburban' },
  { placeId: 92721884, title: 'Free For All' },
  { placeId: 95205458, title: 'Team Deathmatch' },
  { placeId: 301530843, title: 'Line Runner' },
  { placeId: 301529772, title: 'Team/FFA Arena' },
  { placeId: 92721754, title: 'Capture The Flag' },
  { placeId: 95206881, title: 'Baseplate' },
  { placeId: 95206192, title: 'Flat Terrain' },
  { placeId: 95269276, title: 'Control Points' },
  { placeId: 203783329, title: 'City' },
  { placeId: 203810088, title: 'Castle' },
  { placeId: 203812057, title: 'Classic Obby' },
  { placeId: 203885589, title: 'Combat' },
  { placeId: 215383192, title: 'Classic Racing' },
  { placeId: 264715997, title: 'Infinite Runner' },
  { placeId: 264719325, title: 'Pirate Island' },
];

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRobloxProfileExperiences(html) {
  const text = html || '';
  const entries = [];
  const seen = new Set();

  const anchorRegex = /<a[^>]*href=["'](?:https?:\/\/)?(?:www\.)?roblox\.com\/games\/(\d+)(?:\/[^"']*)?["'][^>]*>(.*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(text)) !== null) {
    const placeId = Number(match[1]);
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ''));

    if (!Number.isFinite(placeId) || !title || title.length < 2) {
      continue;
    }

    const normalizedTitle = title.replace(/\s+/g, ' ').trim();
    if (seen.has(placeId)) {
      continue;
    }

    seen.add(placeId);
    entries.push({ placeId, title: normalizedTitle });
  }

  if (entries.length === 0) {
    return FALLBACK_TEMPLATE_ITEMS.map((item) => ({ ...item, title: item.title.trim() }));
  }

  return entries;
}

function fetchRobloxProfileHtml(url = ROBLOX_PROFILE_TEMPLATE_URL) {
  const command = process.platform === 'win32'
    ? [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `try { (Invoke-WebRequest -Uri '${url}' -UseBasicParsing).Content } catch { '' }`,
      ]
    : ['curl', '-L', '-A', 'Mozilla/5.0', '--max-time', '15', url];

  try {
    const output = execSync(command[0] === 'powershell' ? command.join(' ') : command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return output || '';
  } catch (error) {
    return '';
  }
}

function getRobloxProfileTemplateItems() {
  const html = fetchRobloxProfileHtml();
  const parsed = parseRobloxProfileExperiences(html);
  return parsed.filter((item) => Number.isFinite(item.placeId) && item.placeId > 0);
}

module.exports = {
  ROBLOX_PROFILE_TEMPLATE_URL,
  FALLBACK_TEMPLATE_ITEMS,
  parseRobloxProfileExperiences,
  fetchRobloxProfileHtml,
  getRobloxProfileTemplateItems,
};
