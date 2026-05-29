import { useEffect, type ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { setCurrentEnter } from "../lib/remoteFocus";

// A focusable card. `focused` is driven by spatial navigation; OK/Enter fires
// onEnter. Used for nav tiles, article titles, book cards, etc.
export function Tile({
  focusKey,
  onEnter,
  className = "",
  children,
}: {
  focusKey: string;
  onEnter?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onEnter });

  // Expose this tile's action while focused, so the phone remote's OK can fire it.
  useEffect(() => {
    if (focused) setCurrentEnter(onEnter ?? null);
  }, [focused, onEnter]);

  return (
    <div
      ref={ref}
      className={`tile ${focused ? "tile--focused" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
