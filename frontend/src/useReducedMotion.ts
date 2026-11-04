import {useEffect, useState} from "react";
import {AccessibilityInfo, Platform} from "react-native";

const QUERY = "(prefers-reduced-motion: reduce)";

function initialPreference(): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {return window.matchMedia(QUERY).matches;} catch { /* Use the quiet fallback below. */ }
  }
  // Native preferences resolve asynchronously. Never start an animation before
  // we know that the person permits it (also safe during server rendering).
  return true;
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(initialPreference);
  useEffect(() => {
    let active = true;
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
      let query: MediaQueryList;
      try {query = window.matchMedia(QUERY);} catch {return;}
      const change = (event: MediaQueryListEvent) => {if (active) setReducedMotion(event.matches);};
      setReducedMotion(query.matches);
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", change);
        return () => {active = false; query.removeEventListener("change", change);};
      }
      // Older WebKit uses the original MediaQueryList listener API.
      query.addListener(change);
      return () => {active = false; query.removeListener(change);};
    }

    let revision = 0;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", enabled => {
      revision++; if (active) setReducedMotion(enabled);
    });
    const readRevision = revision;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active && revision === readRevision) setReducedMotion(enabled);
    }).catch(() => { /* Keep animations off if the preference cannot be read. */ });
    return () => {active = false; subscription.remove();};
  }, []);
  return reducedMotion;
}
