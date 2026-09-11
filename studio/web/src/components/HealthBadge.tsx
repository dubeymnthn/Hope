import { HealthInfo } from "../api/client.js";

export function HealthBadge({ health, showReasons = false }: { health: HealthInfo; showReasons?: boolean }) {
  return (
    <span>
      <span className={`badge state-${health.state}`}>{health.state.replace("_", " ")}</span>
      {showReasons && health.reasons.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-1)" }}>
          {health.reasons.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
        </div>
      )}
    </span>
  );
}
