import { useEffect, useRef, useState } from "react";
import {
  useMicLevel,
  useNamedPeer,
  usePerPeerValue,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Reading = {
  /** RMS audio level on 0-100 scale, smoothed. */
  level: number;
  /** True when peer has armed its mic. */
  armed: boolean;
  name: string;
};

const ROLE_KEY = (prefix: string) => `${prefix}:role`;
type Role = "peer" | "monitor";

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="shhh-screen">
        <h1>shhh-meter</h1>
        <p className="shhh-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const { name, setName, myName } = useNamedPeer(config, room);
  const [role, setRole] = useState<Role>(
    () => (localStorage.getItem(ROLE_KEY(config.storagePrefix)) as Role) ?? "peer",
  );
  const [armed, setArmed] = useState(false);
  const readings = usePerPeerValue<Reading>(room, "readings", { level: 0, armed: false, name: "" });
  const mic = useMicLevel({ armed, smoothMs: 100 });
  const lastPubRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(ROLE_KEY(config.storagePrefix), role);
  }, [role, config.storagePrefix]);

  // Publish my reading at ~4 Hz when armed; clear when disarmed.
  useEffect(() => {
    if (!armed) {
      readings.clearMy();
      return;
    }
    const now = performance.now();
    if (now - lastPubRef.current < 250) return;
    lastPubRef.current = now;
    readings.setMy({
      level: Math.round(mic.level * 100),
      armed: true,
      name: myName,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.level, armed, myName]);

  // On disarm, also clear (covers component-mount-time race).
  useEffect(() => {
    return () => {
      if (armed) readings.clearMy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myLevelDisplay = Math.round(mic.level * 100);
  const list = readings.entries.map(([id, r]) => ({ id, r })).sort((a, b) => b.r.level - a.r.level);
  const armedPeers = list.filter((r) => r.r.armed);
  const avg =
    armedPeers.length > 0 ? armedPeers.reduce((s, r) => s + r.r.level, 0) / armedPeers.length : 0;

  return (
    <div className="shhh-screen" data-role={role}>
      <header className="shhh-header">
        <h1>shhh-meter</h1>
        <div className="shhh-role-switch">
          <button
            type="button"
            className={role === "peer" ? "is-active" : ""}
            onClick={() => setRole("peer")}
          >
            student (mic)
          </button>
          <button
            type="button"
            className={role === "monitor" ? "is-active" : ""}
            onClick={() => setRole("monitor")}
          >
            teacher (monitor)
          </button>
        </div>
      </header>

      {role === "peer" && (
        <>
          <input
            className="shhh-name"
            placeholder="your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
          />
          {!armed ? (
            <button type="button" className="shhh-arm" onClick={() => setArmed(true)}>
              arm mic
            </button>
          ) : (
            <>
              <p className="shhh-armed">live · {myLevelDisplay}/100</p>
              <div
                className="shhh-bar"
                style={{ "--lvl": `${myLevelDisplay}%` } as React.CSSProperties}
              >
                <div className="shhh-bar-fill" />
              </div>
              <button type="button" className="shhh-disarm" onClick={() => setArmed(false)}>
                disarm
              </button>
              {mic.error && <p className="shhh-error">mic error: {mic.error}</p>}
            </>
          )}
        </>
      )}

      {role === "monitor" && (
        <>
          <p className="shhh-class-avg">
            class avg: <strong>{Math.round(avg)}</strong> / 100 · {armedPeers.length} mic
            {armedPeers.length === 1 ? "" : "s"} armed
          </p>
          <div className="shhh-class-bar" style={{ "--lvl": `${avg}%` } as React.CSSProperties}>
            <div className="shhh-bar-fill" />
          </div>
          <ul className="shhh-list">
            {list.length === 0 && <li className="shhh-empty">no mics yet</li>}
            {list.map(({ id, r }) => (
              <li key={id} className={`shhh-peer ${r.armed ? "is-armed" : "is-idle"}`}>
                <span className="shhh-peer-name">{r.name}</span>
                <div
                  className="shhh-peer-bar"
                  style={{ "--lvl": `${r.level}%` } as React.CSSProperties}
                >
                  <div className="shhh-bar-fill" />
                </div>
                <span className="shhh-peer-val">{r.armed ? Math.round(r.level) : "—"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
