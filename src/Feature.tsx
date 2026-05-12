import { useEffect, useRef, useState } from "react";
import type { MeshConfig, YRoom } from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Reading = {
  /** RMS audio level on 0-100 scale, smoothed. */
  level: number;
  /** True when peer has armed its mic. */
  armed: boolean;
  name: string;
};

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;
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
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [role, setRole] = useState<Role>(
    () => (localStorage.getItem(ROLE_KEY(config.storagePrefix)) as Role) ?? "peer",
  );
  const [armed, setArmed] = useState(false);
  const [myLevel, setMyLevel] = useState(0);
  const [, rerender] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);
  useEffect(() => {
    localStorage.setItem(ROLE_KEY(config.storagePrefix), role);
  }, [role, config.storagePrefix]);

  useEffect(() => {
    const yReadings = room.doc.getMap<Reading>("readings");
    const onChange = () => rerender((n) => n + 1);
    yReadings.observe(onChange);
    return () => yReadings.unobserve(onChange);
  }, [room]);

  // Publish my level when armed (throttled in the audio loop itself).
  const publish = (level: number, armedNow: boolean) => {
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Reading>("readings").set(room.peerId, {
      level: Math.round(level),
      armed: armedNow,
      name: myName,
    });
  };

  // Audio setup
  useEffect(() => {
    if (!armed) {
      // On disarm: stop stream, publish armed=false
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Don't publish a phantom reading when not armed — keeps the teacher
      // view limited to peers who actually have their mic on.
      room.doc.getMap<Reading>("readings").delete(room.peerId);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let smoothed = 0;
        let lastPub = 0;
        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) * (buf[i] ?? 0);
          const rms = Math.sqrt(sum / buf.length); // 0..~1
          const db = 20 * Math.log10(Math.max(rms, 1e-6)); // -120..0
          // Map -60 dB (silence) → 0, -10 dB (loud) → 100
          const level = Math.max(0, Math.min(100, ((db + 60) / 50) * 100));
          smoothed = smoothed * 0.7 + level * 0.3;
          setMyLevel(smoothed);
          const now = performance.now();
          if (now - lastPub > 250) {
            publish(smoothed, true);
            lastPub = now;
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.warn("[shhh] mic denied", err);
        setArmed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  const readings: Array<{ id: string; r: Reading }> = [];
  room.doc.getMap<Reading>("readings").forEach((r, id) => readings.push({ id, r }));
  readings.sort((a, b) => b.r.level - a.r.level);

  const armedPeers = readings.filter((r) => r.r.armed);
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
              <p className="shhh-armed">live · {Math.round(myLevel)}/100</p>
              <div className="shhh-bar" style={{ "--lvl": `${myLevel}%` } as React.CSSProperties}>
                <div className="shhh-bar-fill" />
              </div>
              <button type="button" className="shhh-disarm" onClick={() => setArmed(false)}>
                disarm
              </button>
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
            {readings.length === 0 && <li className="shhh-empty">no mics yet</li>}
            {readings.map(({ id, r }) => (
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
