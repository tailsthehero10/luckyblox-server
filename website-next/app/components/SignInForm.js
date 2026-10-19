'use client';

import { useActionState } from 'react';
import { signInAction } from '../actions/auth';

const initialState = { ok: false, message: '' };

export default function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form className="lb-form" action={formAction}>
      {state && state.message && !state.ok ? (
        <p className="lb-note lb-note-error" role="alert">{state.message}</p>
      ) : null}

      <label className="lb-field">
        <span>Username</span>
        <input name="username" type="text" autoComplete="username" required autoFocus />
      </label>

      <label className="lb-field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

      <button className="lb-btn lb-btn-primary" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}