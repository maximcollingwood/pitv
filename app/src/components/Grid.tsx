import type { ReactNode } from "react";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";

// A spatial-navigation container. Children should be <Tile>s (or other
// focusables); the remote's D-pad moves focus between them.
export function Grid({
  children,
  className = "grid",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { ref, focusKey } = useFocusable();
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
