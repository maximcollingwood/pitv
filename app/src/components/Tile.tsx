import type { ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";

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
  return (
    <div
      ref={ref}
      className={`tile ${focused ? "tile--focused" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
