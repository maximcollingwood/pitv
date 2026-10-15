import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { RemoteAction } from "../lib/api";

// A normal swipe moves one item: the first step needs FIRST_STEP of travel,
// each further step another STEP, so only a long drag keeps stepping (like the
// Apple TV remote's touch surface). A short flick that never reaches the first
// step still counts once when the finger lifts.
const FIRST_STEP = 48;
const STEP = 150;
const FLICK = 28;
const TAP_SLOP = 12;
const TAP_MS = 450;
const KEYS: Record<string, RemoteAction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "select", " ": "select" };

interface Gesture { id: number; x: number; y: number; startX: number; startY: number; at: number; moved: boolean }

function direction(dx: number, dy: number): RemoteAction {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
}

export function TouchPad({ disabled, title, detail, onAction }: { disabled: boolean; title: string; detail: string; onAction: (action: RemoteAction) => void }) {
  const gesture = useRef<Gesture | null>(null);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const [cue, setCue] = useState<{ action: RemoteAction; key: number } | null>(null);

  function fire(action: RemoteAction) {
    onAction(action);
    setCue((current) => ({ action, key: (current?.key ?? 0) + 1 }));
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: event.timeStamp, moved: false };
    setTouch(point(event));
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    setTouch(point(event));
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    const travel = Math.max(Math.abs(dx), Math.abs(dy));
    const threshold = current.moved ? STEP : FIRST_STEP;
    if (travel < threshold) return;
    // A fast drag arrives as a few large moves, so count whole steps (at most two at once).
    const steps = Math.min(2, 1 + Math.floor((travel - threshold) / STEP));
    const action = direction(dx, dy);
    for (let step = 0; step < steps; step++) fire(action);
    // Keep the leftover travel on the swiped axis; drift on the other resets.
    const used = threshold + (steps - 1) * STEP;
    if (action === "left" || action === "right") { current.x += Math.sign(dx) * used; current.y = event.clientY; }
    else { current.y += Math.sign(dy) * used; current.x = event.clientX; }
    current.moved = true;
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setTouch(null);
    if (current.moved) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    const travel = Math.hypot(dx, dy);
    if (travel >= FLICK) fire(direction(dx, dy));
    else if (travel < TAP_SLOP && event.timeStamp - current.at < TAP_MS) fire("select");
  }
  function cancel(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setTouch(null);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const action = KEYS[event.key];
    if (!action || disabled) return;
    event.preventDefault();
    fire(action);
  }

  return <>
    <div className={`touchpad ${disabled ? "is-disabled" : ""} ${touch ? "is-touching" : ""}`} tabIndex={disabled ? -1 : 0}
      aria-label="Touch pad. Swipe to move, tap to select. Arrow keys and Enter also work." aria-disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={key}
      onContextMenu={(event) => event.preventDefault()}>
      <div className="touchpad__hint" aria-hidden="true">
        <p className="touchpad__title">{title}</p>
        <p className="touchpad__detail">{detail}</p>
      </div>
      {touch && <span className="touchpad__finger" style={{ left: touch.x, top: touch.y }} aria-hidden="true" />}
      {cue && <span key={cue.key} className={`touchpad__cue touchpad__cue--${cue.action}`} aria-hidden="true" />}
    </div>
    {/* Screen readers take over swipes, so they get plain buttons instead. */}
    <div className="visually-hidden">
      {(["up", "left", "select", "right", "down"] as RemoteAction[]).map((action) =>
        <button key={action} type="button" disabled={disabled} onClick={() => onAction(action)}>{action === "select" ? "Select" : `Move ${action}`}</button>)}
    </div>
  </>;
}
