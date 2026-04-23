import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSendCode: (email: string) => Promise<void>;
  onVerify: (email: string, code: string) => Promise<void>;
  onContinueAsGuest: () => void;
  error?: { message: string } | null;
}

export function AuthModal({ open, onClose, onSendCode, onVerify, onContinueAsGuest, error }: Props) {
  const [sentEmail, setSentEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef  = useRef<HTMLInputElement>(null);

  // Reset when modal closes.
  useEffect(() => {
    if (!open) {
      setSentEmail("");
      setBusy(false);
      setLocalError(null);
    }
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailRef.current?.value.trim();
    if (!email) return;
    setBusy(true); setLocalError(null);
    try {
      await onSendCode(email);
      setSentEmail(email);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeRef.current?.value.trim();
    if (!code) return;
    setBusy(true); setLocalError(null);
    try {
      await onVerify(sentEmail, code);
      // Success: parent will close the modal via effect on auth state.
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid code");
      if (codeRef.current) codeRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  const handleBackdropClick = (ev: React.MouseEvent) => {
    if (ev.target === ev.currentTarget) onClose();
  };

  const errMsg = localError ?? error?.message ?? null;

  if (!open) return null;

  return (
    <div className="ms-modal-backdrop open" onClick={handleBackdropClick}>
      <div className="ms-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Open a File</h2>
        <p className="sub">The Ministry keeps record of every match, victory, and defeat.</p>

        {errMsg && <p className="ms-modal-error">{errMsg}</p>}

        {!sentEmail ? (
          <form onSubmit={handleSendCode}>
            <label htmlFor="ms-auth-email">Email</label>
            <input
              id="ms-auth-email"
              ref={emailRef}
              type="email"
              placeholder="you@example.com"
              autoFocus
              required
              disabled={busy}
            />
            <div className="ms-modal-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Sending…" : "Send Login Code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <p className="ms-auth-info">Code sent to <strong>{sentEmail}</strong></p>
            <label htmlFor="ms-auth-code">Login Code</label>
            <input
              id="ms-auth-code"
              ref={codeRef}
              type="text"
              placeholder="Enter code"
              autoFocus
              required
              disabled={busy}
            />
            <div className="ms-modal-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Verifying…" : "Sign In"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSentEmail("")} disabled={busy}>
                Use a different email
              </button>
            </div>
          </form>
        )}

        <div className="ms-guest-divider">or</div>
        <button className="btn-secondary" onClick={onContinueAsGuest}>Continue as Guest</button>
        <p className="ms-guest-note">Bot games only — no record is kept and online play stays sealed.</p>
      </div>
    </div>
  );
}
