"use client";

import { useState } from "react";

interface LoginFormProps {
  labels: {
    email: string;
    submit: string;
    success: string;
  };
}

export function LoginForm({ labels }: LoginFormProps) {
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setVerificationUrl("");
    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create magic link");
      setVerificationUrl(payload.verificationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create magic link");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card formGrid" action={submit}>
      <label>
        {labels.email}
        <input name="email" placeholder="you@example.com" required type="email" />
      </label>
      <button className="button" disabled={pending} type="submit">
        {pending ? "..." : labels.submit}
      </button>
      {verificationUrl ? (
        <p className="notice">
          {labels.success} <a href={verificationUrl}>{verificationUrl}</a>
        </p>
      ) : null}
      {error ? <p className="notice error">{error}</p> : null}
    </form>
  );
}
