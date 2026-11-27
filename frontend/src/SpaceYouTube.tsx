import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "./ThemeContext";
import type { SpaceState } from "./spaces";
import { API_ORIGIN } from "./config";
import { playbackCorrection, playbackPosition, timelineNow } from "./spacePlayback";

type YouTubePlayer = { playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };
type YouTubeGlobal = { Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
declare global { interface Window { YT?: YouTubeGlobal; onYouTubeIframeAPIReady?: () => void } }
let loadingApi: Promise<YouTubeGlobal> | null = null;
function loadYouTube(): Promise<YouTubeGlobal> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loadingApi) return loadingApi;
  loadingApi = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => { loadingApi = null; reject(new Error("YouTube is taking too long to load.")); }, 15000);
    window.onYouTubeIframeAPIReady = () => { previous?.(); clearTimeout(timeout); if (window.YT?.Player) resolve(window.YT); else reject(new Error("YouTube is unavailable.")); };
    let script = document.getElementById("kuku-youtube-api") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script"); script.id = "kuku-youtube-api"; script.src = "https://www.youtube.com/iframe_api"; script.async = true;
      script.onerror = () => { clearTimeout(timeout); loadingApi = null; script?.remove(); reject(new Error("YouTube could not be loaded. Check your connection.")); };
      document.head.appendChild(script);
    }
  });
  return loadingApi;
}
type Status = "loading" | "ready" | "buffering" | "blocked" | "error";
export default function SpaceYouTube({ videoId, state, offsetMs, onDuration }: { videoId: string; state: SpaceState; offsetMs: number; onDuration?: (seconds: number) => void }) {
  const { c, f } = useTheme();
  const container = useRef<HTMLElement | null>(null), player = useRef<YouTubePlayer | null>(null), native = useRef<WebView | null>(null);
  const latest = useRef({ state, offsetMs, onDuration }); latest.current = { state, offsetMs, onDuration };
  const [status, setStatus] = useState<Status>("loading"), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const ready = useRef(false), blocked = useRef(false), active = useRef(false), lastSeek = useRef(0);
  const valid = /^[A-Za-z0-9_-]{11}$/.test(videoId);

  function sync(force = false) {
    if (!ready.current || blocked.current || !active.current) return;
    const target = playbackPosition(latest.current.state, timelineNow(), latest.current.offsetMs);
    if (Platform.OS !== "web") {
      native.current?.injectJavaScript("window.KukuSync&&window.KukuSync(" + JSON.stringify({ target, playing: latest.current.state.is_playing, force }) + ");true;");
      return;
    }
    const media = player.current;
    if (!media) return;
    try {
      const duration = media.getDuration(), position = duration > 0 ? Math.min(duration, target) : target;
      if (duration > 0 && Number.isFinite(duration)) latest.current.onDuration?.(duration);
      if (duration > 0 && position >= duration - 0.05) { media.pauseVideo(); return; }
      if (playbackCorrection(media.getCurrentTime(), position, force) === "seek" && (force || timelineNow() - lastSeek.current > 3000)) {
        media.seekTo(position, true); lastSeek.current = timelineNow();
      }
      const actual = media.getPlayerState();
      if (latest.current.state.is_playing && actual !== 1 && actual !== 3) media.playVideo();
      if (!latest.current.state.is_playing && actual !== 2 && actual !== 0) media.pauseVideo();
    } catch { setError("Playback could not be synchronized. Try rejoining."); setStatus("error"); }
  }
  useEffect(() => {
    active.current = true; ready.current = false; blocked.current = false; setStatus("loading"); setError("");
    if (!valid) { setStatus("error"); setError("This YouTube link is unavailable."); return () => { active.current = false; }; }
    let live = true;
    if (Platform.OS === "web" && container.current) {
      const root = container.current, element = document.createElement("div"); root.replaceChildren(element);
      void loadYouTube().then(YT => {
        if (!live) return;
        player.current = new YT.Player(element, {
          width: "100%", height: "100%", videoId,
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, enablejsapi: 1, origin: window.location.origin },
          events: {
            onReady: () => { if (live) { ready.current = true; setStatus("ready"); sync(true); } },
            onAutoplayBlocked: () => { if (live) { blocked.current = true; setStatus("blocked"); } },
            onStateChange: (event: { data: number }) => { if (live) setStatus(blocked.current ? "blocked" : event.data === 3 ? "buffering" : "ready"); },
            onError: (event: { data: number }) => { if (live) { ready.current = false; setError(event.data === 101 || event.data === 150 ? "This video does not allow playback inside KUKU." : "This video is unavailable. The host can choose another."); setStatus("error"); } },
          },
        });
      }).catch(cause => { if (live) { setError(cause.message); setStatus("error"); } });
    }
    const timeout = setTimeout(() => { if (live && !ready.current) { setError("YouTube is taking too long to load. Try again."); setStatus("error"); } }, 18000);
    const interval = setInterval(() => sync(), 1500);
    return () => { live = false; active.current = false; ready.current = false; clearInterval(interval); clearTimeout(timeout); try { player.current?.destroy(); } catch { /* The provider may already have removed its iframe. */ } player.current = null; };
  }, [videoId, revision, valid]);

  useEffect(() => { sync(true); }, [state.version, state.updated_at, state.is_playing, offsetMs]);
  function resume() {
    blocked.current = false; setStatus("ready");
    if (Platform.OS === "web") player.current?.playVideo();
    else native.current?.injectJavaScript("window.YTPlayer&&window.YTPlayer.playVideo();true;");
    sync(true);
  }
  return <View style={{ gap: 10 }}>
    <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "#14120F", borderRadius: 18, overflow: "hidden" }}>
      {Platform.OS === "web" ? React.createElement("div", { ref: (node: HTMLElement | null) => { container.current = node; }, style: { width: "100%", height: "100%" }, "data-testid": "youtube-player" }) :
        <WebView key={videoId + revision} ref={native} source={{ html: youtubeHtml(videoId, API_ORIGIN), baseUrl: API_ORIGIN }} style={{ flex: 1, backgroundColor: "#14120F" }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled testID="youtube-player"
          onMessage={event => {
            try {
              const message = JSON.parse(event.nativeEvent.data);
              if (!active.current) return;
              if (message.type === "ready") { ready.current = true; setStatus("ready"); sync(true); }
              else if (message.type === "blocked") { blocked.current = true; setStatus("blocked"); }
              else if (message.type === "buffering") setStatus("buffering");
              else if (message.type === "playing") { blocked.current = false; setStatus("ready"); }
              else if (message.type === "duration" && typeof message.duration === "number" && message.duration > 0 && Number.isFinite(message.duration)) latest.current.onDuration?.(message.duration);
              else if (message.type === "error") { ready.current = false; setError("This video is unavailable or does not permit embedded playback."); setStatus("error"); }
            } catch { /* Ignore non-protocol frames. */ }
          }}
          onError={() => { setError("YouTube could not be loaded. Check your connection."); setStatus("error"); }}
        />}
    </View>
    {status === "loading" || status === "buffering" ? <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="small" color={c.primaryDark} /><Text style={{ color: c.textSecondary, fontFamily: f.body }}>{status === "loading" ? "Opening YouTube…" : "Buffering…"}</Text></View> : null}
    {status === "blocked" ? <Pressable accessibilityRole="button" onPress={resume} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryBgSubtle, borderRadius: 24 }} testID="space-resume-video"><Text style={{ color: c.primaryDark, fontFamily: f.bodyBold }}>Tap to join playback</Text></Pressable> : null}
    {status === "error" ? <View style={{ alignItems: "center", gap: 6 }}><Text accessibilityRole="alert" style={{ color: c.error, fontFamily: f.body, textAlign: "center" }}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 20 }}><Text style={{ color: c.primaryDark, fontFamily: f.bodyBold }}>Reload player</Text></Pressable></View> : null}
  </View>;
}
export function youtubeHtml(videoId: string, origin = API_ORIGIN): string {
  const safeId = /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#player{margin:0;width:100%;height:100%;background:#14120F;overflow:hidden}</style></head><body><div id="player"></div><script>' +
    'function emit(type,details){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},details||{})));}var lastSeek=0,lastDuration=0;' +
    'window.KukuSync=function(s){if(!window.YTPlayer)return;try{var p=YTPlayer.getCurrentTime(),d=YTPlayer.getDuration(),t=d>0?Math.min(d,s.target):s.target;' +
    'if(d>0&&d!==lastDuration){emit("duration",{duration:d});lastDuration=d;}if(d>0&&t>=d-0.05){YTPlayer.pauseVideo();return;}' +
    'if(Math.abs(p-t)>(s.force ? 0.25 : 0.75)&&(s.force||Date.now()-lastSeek>3000)){YTPlayer.seekTo(t,true);lastSeek=Date.now();}' +
    'var a=YTPlayer.getPlayerState();if(s.playing&&a!==1&&a!==3)YTPlayer.playVideo();if(!s.playing&&a!==2&&a!==0)YTPlayer.pauseVideo();}catch(e){emit("error");}};' +
    'function onYouTubeIframeAPIReady(){window.YTPlayer=new YT.Player("player",{videoId:' + JSON.stringify(safeId) +
    ',playerVars:{autoplay:0,controls:0,disablekb:1,rel:0,playsinline:1,enablejsapi:1,origin:' + JSON.stringify(origin).replace(/</g, "\\u003c") + '},events:{onReady:function(){emit("ready");},onAutoplayBlocked:function(){emit("blocked");},onStateChange:function(e){if(e.data===3)emit("buffering");if(e.data===1)emit("playing");},onError:function(){emit("error");}}});}' +
    '</script><script src="https://www.youtube.com/iframe_api"></script></body></html>';
}
