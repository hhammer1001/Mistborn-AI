import { useState, useRef } from "react";

interface AuthScreenProps {
  onLogin: (email: string, code: string) => Promise<void>;
  onSendCode: (email: string) => Promise<void>;
  error?: { message: string } | null;
}

export function AuthScreen({ onLogin, onSendCode, error }: AuthScreenProps) {
  const [sentEmail, setSentEmail] = useState("");
  const [sending, setSending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailRef.current?.value?.trim();
    if (!email) return;
    setSending(true);
    try {
      await onSendCode(email);
      setSentEmail(email);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send code";
      alert(msg);
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeRef.current?.value?.trim();
    if (!code) return;
    setSending(true);
    try {
      await onLogin(sentEmail, code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      alert(msg);
      if (codeRef.current) codeRef.current.value = "";
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="auth-screen">
      <h1>Mistborn</h1>
      <p className="auth-subtitle">Sign in to play online</p>

      {error && <p className="auth-error">{error.message}</p>}

      {!sentEmail ? (
        <form onSubmit={handleSendCode} className="auth-form">
          <input
            ref={emailRef}
            type="email"
            placeholder="Enter your email"
            autoFocus
            required
          />
          <button type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send Login Code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="auth-form">
          <p className="auth-info">Code sent to {sentEmail}</p>
          <input
            ref={codeRef}
            type="text"
            placeholder="Enter code"
            autoFocus
            required
          />
          <button type="submit" disabled={sending}>
            {sending ? "Verifying..." : "Sign In"}
          </button>
          <button
            type="button"
            className="auth-back"
            onClick={() => setSentEmail("")}
          >
            Use different email
          </button>
        </form>
      )}
    </div>
  );
}
