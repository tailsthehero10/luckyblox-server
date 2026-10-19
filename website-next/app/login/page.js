import Link from 'next/link';
import SignInForm from '../components/SignInForm';

export const metadata = { title: 'Login - LuckyBlox' };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const signedUp = params && params.signedup === '1';

  return (
    <div className="lb-auth">
      <div className="lb-auth-card">
        <h1 className="lb-auth-title">Login</h1>
        <p className="lb-auth-sub">Sign in to your LuckyBlox account.</p>

        {signedUp ? (
          <p className="lb-note lb-note-ok">Account created. Sign in below.</p>
        ) : null}

        <SignInForm />

        <div className="lb-auth-links">
          <Link href="/forgotpasswordOrUsername">Forgot password or username?</Link>
          <Link href="/login/signup">Create an account</Link>
        </div>

        <Link className="lb-auth-discord" href="/login-with-discord">
          Login with Discord
        </Link>
      </div>
    </div>
  );
}