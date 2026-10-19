import Link from 'next/link';

export const metadata = { title: 'Forgot Password or Username - LuckyBlox' };

/**
 * Recovery page.
 *
 * Account recovery is DISABLED, and this page says so rather than offering a
 * form that cannot work. The bridge has no password-reset endpoint, and adding a
 * fake "email sent" message would be a lie about what happened.
 */
export default function ForgotPage() {
  return (
    <div className="lb-auth">
      <div className="lb-auth-card">
        <h1 className="lb-auth-title">Forgot Password or Username</h1>
        <p className="lb-auth-sub">
          Account recovery is not available on this deployment yet.
        </p>
        <p className="lb-muted">
          A LuckyBlox operator can reset a password directly. If you still have
          access to the account, you can change your password from your account
          page.
        </p>
        <div className="lb-auth-links">
          <Link href="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}