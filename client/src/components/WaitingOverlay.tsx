interface WaitingOverlayProps {
  opponentName: string;
  phase: string;
}

export function WaitingOverlay({ opponentName, phase }: WaitingOverlayProps) {
  let message = `Waiting for ${opponentName}...`;
  if (phase === "sense_defense") {
    message = `${opponentName} is deciding on Sense defense...`;
  } else if (phase === "cloud_defense") {
    message = `${opponentName} is deciding on Cloud defense...`;
  } else if (phase === "damage") {
    message = `${opponentName} is assigning damage...`;
  } else if (phase === "awaiting_prompt") {
    message = `${opponentName} is making a choice...`;
  }

  return (
    <div className="waiting-overlay">
      <div className="waiting-content">
        <div className="waiting-spinner" />
        <p>{message}</p>
      </div>
    </div>
  );
}
