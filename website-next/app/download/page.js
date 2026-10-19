export const dynamic = 'force-dynamic';
export const metadata = { title: 'Download - LuckyBlox' };

const BACKEND = process.env.LUCKYBLOX_BACKEND_URL || 'http://127.0.0.1:3002';

/**
 * Download page.
 *
 * Reports the build the server ACTUALLY has, from /api/client/build-info. When
 * no build is published it says so instead of offering a link that 404s.
 */
async function fetchBuild() {
  try {
    const response = await fetch(`${BACKEND}/api/client/build-info`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

export default async function DownloadPage() {
  const build = await fetchBuild();
  const available = Boolean(build && build.available);

  return (
    <>
      <h1 className="lb-title">Download LuckyBlox</h1>
      <p className="lb-subtitle">Install the player, then join any game from the site.</p>

      <div className="lb-panel">
        {available ? (
          <>
            <div className="lb-dl-row">
              <strong>LuckyBlox Player</strong>
              <span className="lb-muted">
                version {build.version}
                {build.binarySize ? ` · ${(build.binarySize / (1024 * 1024)).toFixed(1)} MB` : ''}
              </span>
            </div>
            <div className="lb-dl-actions">
              <a className="lb-btn lb-btn-primary" href="/download/client">Download installer</a>
              <a className="lb-btn lb-btn-secondary" href="/download/client/binary">Download build</a>
            </div>
          </>
        ) : (
          <p className="lb-muted">
            No client build is published on this server yet. When one is added it
            appears here automatically.
          </p>
        )}
      </div>
    </>
  );
}