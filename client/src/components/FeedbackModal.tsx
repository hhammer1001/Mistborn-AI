import { useState } from "react";

const WEB3FORMS_KEY = import.meta.env.VITE_WEB3FORMS_KEY as string | undefined;

interface Props {
  onClose: () => void;
}

export function FeedbackModal({ onClose }: Props) {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    if (!WEB3FORMS_KEY) {
      setStatus("error");
      setErrorMsg("Feedback is not configured.");
      return;
    }

    setSubmitting(true);
    setStatus("idle");
    try {
      const resp = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: "Mistborn Game Feedback",
          message,
          from_email: email || "anonymous@mistborn-game",
          reply_to: email || undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setStatus("success");
        setMessage("");
        setEmail("");
      } else {
        setStatus("error");
        setErrorMsg(data.message ?? "Failed to send");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="feedback-backdrop" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Send Feedback</h2>
        {status === "success" ? (
          <>
            <p className="feedback-success">Thanks for the feedback!</p>
            <button onClick={onClose}>Close</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label>
              Feedback
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="What's on your mind? Bug reports, feature ideas, anything..."
                required
              />
            </label>
            <label>
              Your email (optional, if you want a reply)
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {status === "error" && (
              <p className="feedback-error">{errorMsg}</p>
            )}
            <div className="feedback-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" disabled={submitting || !message.trim()}>
                {submitting ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
