import Link from 'next/link';

export const metadata = { title: 'Login with Discord - LuckyBlox' };

/**
 * "Login with Discord" entry point.
 *
 * There is no OAuth app configured for this deployment, so the page explains
 * that and sends the visitor to the normal login. It does not render a button
 * that leads to a dead OAuth redirect.
 */
export default function LoginWithDiscordPage() {
  return (
    <div className="lb-auth">
      <div className="lb-auth-card">
        <h1 className="lb-auth-title">Login with Discord</h1>
        <p className="lb-auth-sub">Discord sign-in is not configured on this deployment.</p>
        <div className="lb-auth-links">
          <Link href="/login">Use your LuckyBlox account instead</Link>
        </div>
      </div>
    </div>
  );
}