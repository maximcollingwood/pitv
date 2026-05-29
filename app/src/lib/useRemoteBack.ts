import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Remote/keyboard "Back" → previous screen. TV pages have no text inputs, so
// capturing Backspace/Escape here is safe.
const BACK_KEYS = ["Escape", "Backspace", "BrowserBack", "GoBack"];

export function useRemoteBack() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (BACK_KEYS.includes(e.key)) {
        e.preventDefault();
        navigate(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);
}
