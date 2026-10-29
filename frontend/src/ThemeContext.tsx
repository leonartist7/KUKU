import React, {createContext, useContext, useEffect, useState, useCallback, useMemo, useRef} from "react";
import {AppState, Platform, useColorScheme} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {palettes, ThemeName, Palette, fontPairs, FontPair} from "./theme";
import {AppearanceMode, DecorName, resolveDark, validTime} from "./appearance";

type Preferences = {mode: AppearanceMode; dayTheme: ThemeName; nightTheme: ThemeName; dayAt: string; nightAt: string; decor: DecorName};
const defaults: Preferences = {mode: "schedule", dayTheme: "warm", nightTheme: "evening", dayAt: "07:00", nightAt: "19:00", decor: "plain"};
type ThemeState = Preferences & {c: Palette; themeName: ThemeName; setTheme: (t: ThemeName) => void; setAppearance: (p: Partial<Preferences>) => void; fontKey: FontPair; setFontKey: (f: FontPair) => void; f: typeof fontPairs.fraunces};
const ThemeCtx = createContext<ThemeState | null>(null);
export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [prefs, setPrefs] = useState(defaults);
  const [fontKey, setFontKeyState] = useState<FontPair>("fraunces");
  const [clock, setClock] = useState(() => new Date());
  const scheme = useColorScheme(); const edited = useRef(false); const fontEdited = useRef(false);
  const prefsRef = useRef(prefs);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    void Promise.all([AsyncStorage.getItem("kuku_appearance_v1"), AsyncStorage.getItem("connect_theme"), AsyncStorage.getItem("connect_font")]).then(([raw, legacy, font]) => {
      if (!live) return;
      if (!edited.current) {
        let next = {...defaults};
        if (legacy && Object.prototype.hasOwnProperty.call(palettes, legacy)) {const name = legacy as ThemeName; next[palettes[name].isDark ? "nightTheme" : "dayTheme"] = name;}
        if (raw) {try {
          const p = JSON.parse(raw);
          if (["schedule", "light", "dark", "system"].includes(p.mode)) next.mode = p.mode;
          if (Object.prototype.hasOwnProperty.call(palettes, p.dayTheme) && !palettes[p.dayTheme as ThemeName].isDark) next.dayTheme = p.dayTheme;
          if (Object.prototype.hasOwnProperty.call(palettes, p.nightTheme) && palettes[p.nightTheme as ThemeName].isDark) next.nightTheme = p.nightTheme;
          if (validTime(p.dayAt) && validTime(p.nightAt) && p.dayAt !== p.nightAt) {next.dayAt = p.dayAt; next.nightAt = p.nightAt;}
          if (["plain", "dots", "leaves", "orbits"].includes(p.decor)) next.decor = p.decor;
        } catch { /* keep safe defaults */ }}
        prefsRef.current = next; setPrefs(next);
      }
      if (!fontEdited.current && font && font in fontPairs) setFontKeyState(font as FontPair);
    }).catch(() => {});
    const tick = () => setClock(new Date());
    const timer = setInterval(tick, 1000);
    const sub = AppState.addEventListener("change", state => {if (state === "active") tick();});
    if (Platform.OS === "web") document.addEventListener("visibilitychange", tick);
    return () => {live = false; clearInterval(timer); sub.remove(); if (Platform.OS === "web") document.removeEventListener("visibilitychange", tick);};
  }, []);
  const setAppearance = useCallback((patch: Partial<Preferences>) => {
    edited.current = true;
    const next = {...prefsRef.current, ...patch};
      if (!validTime(next.dayAt) || !validTime(next.nightAt) || next.dayAt === next.nightAt) return;
      // Serialize writes so rapid palette taps cannot leave an older preference on disk.
      writes.current = writes.current.then(() => AsyncStorage.setItem("kuku_appearance_v1", JSON.stringify(next))).catch(() => {});
      prefsRef.current = next; setPrefs(next);
  }, []);
  const setTheme = useCallback((t: ThemeName) => setAppearance(palettes[t].isDark ? {nightTheme: t} : {dayTheme: t}), [setAppearance]);
  const setFontKey = useCallback((font: FontPair) => {fontEdited.current = true; setFontKeyState(font); void AsyncStorage.setItem("connect_font", font).catch(() => {});}, []);
  const dark = resolveDark(prefs.mode, clock, scheme === "dark", prefs.nightAt, prefs.dayAt);
  const themeName = dark ? prefs.nightTheme : prefs.dayTheme;
  const c = palettes[themeName];
  useEffect(() => {
    if (Platform.OS === "web") {document.documentElement.style.colorScheme = c.isDark ? "dark" : "light"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c.bg);}
  }, [c]);
  const value = useMemo(() => ({...prefs, c, themeName, setTheme, setAppearance, fontKey, setFontKey, f: fontPairs[fontKey]}), [prefs, c, themeName, setTheme, setAppearance, fontKey, setFontKey]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
export function useTheme(): ThemeState {
  return useContext(ThemeCtx) || {...defaults, c: palettes.warm, themeName: "warm", setTheme: () => {}, setAppearance: () => {}, fontKey: "fraunces", setFontKey: () => {}, f: fontPairs.fraunces};
}
