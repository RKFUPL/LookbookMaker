"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to sign in.");
      router.replace("/admin");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 5 }}>
        {loading ? <><LoaderCircle size={16} className="spinner" /> Signing in</> : <>Enter catalog studio <ArrowRight size={15} /></>}
      </button>
    </form>
  );
}
