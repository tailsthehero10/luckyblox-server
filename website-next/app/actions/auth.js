'use server';

/**
 * Auth server actions.
 *
 * These run on the SERVER, which is what makes them work at all: the bridge's
 * session cookie is httpOnly and sameSite=lax, so a browser-side form could
 * neither read the CSRF token from its own fetch nor attach the guest cookie
 * cross-origin. Running here keeps the cookie on the server side.
 */

import { redirect } from 'next/navigation';
import { createAccount, signIn } from '../lib/session';

export async function signUpAction(prevState, formData) {
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');
  const passwordConfirm = String(formData.get('passwordConfirm') || '');
  const birthday = String(formData.get('birthday') || '');
  const gender = String(formData.get('gender') || '');
  const discordUserId = String(formData.get('discordUserId') || '');

  if (!username || !password) {
    return { ok: false, message: 'Username and password are required.' };
  }
  if (password !== passwordConfirm) {
    return { ok: false, message: 'Passwords do not match.' };
  }

  const result = await createAccount({
    username,
    password,
    // The bridge calls this field confirmPassword.
    confirmPassword: passwordConfirm,
    birthday,
    gender,
    discordUserId,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  redirect('/login?signedup=1');
}

export async function signInAction(prevState, formData) {
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');

  if (!username || !password) {
    return { ok: false, message: 'Enter your username and password.' };
  }

  const result = await signIn({ username, password });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  redirect('/home');
}