import Link from 'next/link';
import SignUpForm from '../../components/SignUpForm';

export const metadata = { title: 'Sign Up - LuckyBlox' };

export default function SignupPage() {
  return (
    <div className="lb-auth">
      <div className="lb-auth-card">
        <h1 className="lb-auth-title">Sign Up</h1>
        <p className="lb-auth-sub">Create your LuckyBlox account.</p>

        <SignUpForm />

        <div className="lb-auth-links">
          <Link href="/login">Already have an account? Login</Link>
        </div>
      </div>
    </div>
  );
}