'use client';

import { useActionState } from 'react';
import { signUpAction } from '../actions/auth';

const initialState = { ok: false, message: '' };

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <form className="lb-form" action={formAction}>
      {state && state.message && !state.ok ? (
        <p className="lb-note lb-note-error" role="alert">{state.message}</p>
      ) : null}

      <label className="lb-field">
        <span>Username</span>
        <input name="username" type="text" autoComplete="username" maxLength={20} required autoFocus />
      </label>

      <label className="lb-field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="new-password" required />
      </label>

      <label className="lb-field">
        <span>Confirm password</span>
        <input name="passwordConfirm" type="password" autoComplete="new-password" required />
      </label>

      <label className="lb-field">
        <span>Birthday</span>
        <input name="birthday" type="date" required />
      </label>

      <fieldset className="lb-field lb-gender">
        <legend>Gender</legend>
        <label><input type="radio" name="gender" value="2" defaultChecked /> Male</label>
        <label><input type="radio" name="gender" value="3" /> Female</label>
      </fieldset>

      <label className="lb-field">
        <span>Discord user ID (optional)</span>
        <input name="discordUserId" type="text" inputMode="numeric" />
      </label>

      <button className="lb-btn lb-btn-primary" type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Sign Up'}
      </button>
    </form>
  );
}