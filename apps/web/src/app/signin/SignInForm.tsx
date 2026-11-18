"use client";

import { useActionState } from "react";

import { type SignInState, sendCode, verifyCode } from "./actions";
import s from "./signin.module.css";

export function SignInForm({ linkExpired = false }: { linkExpired?: boolean }) {
  const [emailState, sendAction, sending] = useActionState<SignInState, FormData>(sendCode, {
    step: "email",
    error: linkExpired ? "That sign-in link has expired or was already used. Send a new one." : undefined,
  });
  const [codeState, verifyAction, verifying] = useActionState<SignInState, FormData>(verifyCode, { step: "code" });

  if (emailState.step === "code") {
    const err = codeState.error;
    return (
      // Distinct keys so React builds fresh inputs instead of reusing the email field.
      <form key="code" action={verifyAction} className={s.form}>
        <p className={s.lede}>
          Check {emailState.email}. If the email has a number, type it below. If it has a link instead, open it in this
          browser. It can take a minute to arrive.
        </p>
        <input type="hidden" name="email" defaultValue={emailState.email ?? ""} />
        <label className={s.label} htmlFor="code">
          Code
        </label>
        <input
          id="code"
          name="code"
          className={s.input}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={12}
          autoFocus
          required
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? "code-err" : undefined}
        />
        {err ? (
          <p id="code-err" className={s.error} role="alert">
            {err}
          </p>
        ) : null}
        <button className={s.button} disabled={verifying}>
          {verifying ? "Checking…" : "Sign in"}
        </button>
      </form>
    );
  }

  const err = emailState.error;
  return (
    <form key="email" action={sendAction} className={s.form}>
      <label className={s.label} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        className={s.input}
        autoComplete="email"
        defaultValue={emailState.email}
        required
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? "email-err" : undefined}
      />
      {err ? (
        <p id="email-err" className={s.error} role="alert">
          {err}
        </p>
      ) : null}
      <button className={s.button} disabled={sending}>
        {sending ? "Sending…" : "Email me a code"}
      </button>
    </form>
  );
}
