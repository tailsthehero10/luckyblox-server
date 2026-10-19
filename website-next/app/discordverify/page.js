import Link from 'next/link';

export const metadata = { title: 'Discord Verification - LuckyBlox' };

/**
 * Discord verification.
 *
 * The bridge stores a `discordUserId` on the account but has no verification
 * service to confirm ownership of it, so this page explains the state instead of
 * pretending to verify. When a verifier is added, this is the page it fills in.
 */
export default function DiscordVerifyPage() {
  return (
    <div className="lb-auth">
      <div className="lb-auth-card">
        <h1 className="lb-auth-title">Discord Verification</h1>
        <p className="lb-auth-sub">Link your Discord account to LuckyBlox.</p>
        <p className="lb-muted">
          Discord verification is not enabled on this deployment. You can still add
          your Discord user ID when you sign up, and it is stored on your account.
        </p>
        <div className="lb-auth-links">
          <Link href="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}