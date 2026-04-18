import { useEffect, useRef, useState } from "react";

type Tone = "health" | "damage" | "money" | "mission" | "default";

interface Props {
  value: number;
  tone?: Tone;
}

interface Float {
  id: number;
  delta: number;
}

export function AnimatedNumber({ value, tone = "default" }: Props) {
  const prevRef = useRef(value);
  const idRef = useRef(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;
    const delta = value - prev;
    prevRef.current = value;

    idRef.current += 1;
    const id = idRef.current;
    setFloats((f) => [...f, { id, delta }]);
    setPulse(true);

    const pulseTimer = setTimeout(() => setPulse(false), 400);
    const floatTimer = setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, 1000);
    return () => {
      clearTimeout(pulseTimer);
      clearTimeout(floatTimer);
    };
  }, [value]);

  return (
    <span className={`animated-number${pulse ? " pulse" : ""}`}>
      {value}
      {floats.map((f) => (
        <span
          key={f.id}
          className={`float-delta tone-${tone} ${f.delta > 0 ? "pos" : "neg"}`}
        >
          {f.delta > 0 ? "+" : ""}{f.delta}
        </span>
      ))}
    </span>
  );
}
