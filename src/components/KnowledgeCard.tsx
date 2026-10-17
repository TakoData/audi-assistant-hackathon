import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { TakoCard } from "../types";
import { toGlanceableUrl } from "../tako";

function cardDocument(url: string) {
  const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{width:100%;height:100%;margin:0;background:#101B27;overflow:hidden}
iframe{border:0;width:100%;height:100%;display:block;background:#101B27}</style>
</head><body><iframe id="card" src="${safeUrl}" scrolling="auto"></iframe>
<script>
var frame = document.getElementById('card');
window.addEventListener('message', function(event) {
  if(event.source !== frame.contentWindow) return;
  var data = event.data;
  if(typeof data === 'string') {try {data=JSON.parse(data)}catch(e){return}}
  if(data && data.type === 'tako::resize' && Number(data.height) > 0) {
    window.ReactNativeWebView.postMessage(JSON.stringify({height:Number(data.height)}));
  }
});
</script></body></html>`;
}

export function KnowledgeCard({ card, showTitle = true }: { card: TakoCard; showTitle?: boolean }) {
  const url = toGlanceableUrl(card.embedUrl);
  const [cardHeight, setCardHeight] = useState(300);
  const [loadFailed, setLoadFailed] = useState(!url);
  const [reloadKey, setReloadKey] = useState(0);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    setLoadFailed(!url);
    if (!url) return;
    loadTimeout.current = setTimeout(() => setLoadFailed(true), 12_000);
    return () => {
      if (loadTimeout.current) clearTimeout(loadTimeout.current);
    };
  }, [reloadKey, url]);

  return (
    <View style={styles.shell}>
      {showTitle && <View style={styles.header}>
        <Text allowFontScaling={false} numberOfLines={2} ellipsizeMode="tail" style={styles.title}>{card.title}</Text>
      </View>}
      <View style={[styles.cardViewport, { height: cardHeight }]}>
        {loadFailed ? (
          <View style={styles.fallback}>
            <View style={styles.fallbackIcon}><Text style={styles.fallbackIconText}>!</Text></View>
            <Text style={styles.fallbackTitle}>Visual temporarily unavailable</Text>
            <Text numberOfLines={3} style={styles.fallbackCopy}>{card.description || "Scroll down to read the answer, or use the speaker button to listen."}</Text>
            {!!url && (
              <Pressable onPress={() => { setLoadFailed(false); setReloadKey((key) => key + 1); }} style={styles.retryButton}>
                <Text style={styles.retryText}>Reload visual</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <WebView
            key={`${url}-${reloadKey}`}
            onMessage={event => {
              try {
                const height = JSON.parse(event.nativeEvent.data).height;
                if (Number.isFinite(height) && height > 0) { setCardHeight(Math.max(160, Math.min(1200, Math.ceil(height)))); setLoadFailed(false); if(loadTimeout.current) clearTimeout(loadTimeout.current); console.info("AUDI_CARD_READY", height); }
              } catch {}
            }}
            source={{ html: cardDocument(url), baseUrl: "https://tako.com" }}
            originWhitelist={["https://*", "about:blank"]}
            style={styles.webview}
            containerStyle={styles.webviewContainer}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color="#A7C2FF" size="large" />
                <Text style={styles.loadingText}>Preparing driver view…</Text>
              </View>
            )}
            onError={() => setLoadFailed(true)}
            onHttpError={() => setLoadFailed(true)}
            // Only the embedded card's resize handshake clears the timeout;
            // the outer HTML loading alone does not mean the card is available.
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            overScrollMode="never"
            allowsFullscreenVideo={false}
          />
        )}
      </View>
      {card.sources.length > 0 && (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.sources}>Source: {card.sources.join(" · ")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    borderRadius: 0,
    backgroundColor: "#101B27",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  header: { paddingVertical: 8, paddingHorizontal: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 2, paddingHorizontal: 0, paddingVertical: 6 },
  badgeMark: { width: 3, height: 13, backgroundColor: "#A7C2FF" },
  badgeText: { color: "#C8C8C8", fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: "#CCD7E8", fontSize: 12, fontWeight: "500" },
  highlight: { height: 84, justifyContent: "center", paddingHorizontal: 17, paddingVertical: 10, backgroundColor: "#1C1C1C", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  highlightLabel: { color: "#A7C2FF", fontSize: 8, fontWeight: "900", letterSpacing: 1.6, marginBottom: 5 },
  highlightText: { color: "#F5F5F5", fontSize: 18, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2 },
  highlightTextCompact: { fontSize: 17, lineHeight: 22 },
  cardViewport: { marginHorizontal: 0, marginVertical: 0, borderRadius: 2, overflow: "hidden", backgroundColor: "#101B27" },
  webviewContainer: { flex: 1, backgroundColor: "#101B27" },
  webview: { flex: 1, backgroundColor: "#101B27" },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#101B27" },
  loadingText: { color: "#9DA8A5", fontSize: 13 },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, backgroundColor: "#101B27" },
  fallbackIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(226,0,21,0.14)", marginBottom: 10 },
  fallbackIconText: { color: "#A7C2FF", fontSize: 22, fontWeight: "800" },
  fallbackTitle: { color: "#EAF1EF", fontSize: 17, fontWeight: "700" },
  fallbackCopy: { color: "#93A2A8", fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 7, maxWidth: 420 },
  retryButton: { marginTop: 14, borderRadius: 2, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: "rgba(226,0,21,0.45)" },
  retryText: { color: "#A7C2FF", fontSize: 11, fontWeight: "800" },
  sources: { color: "#7E929E", fontSize: 10, paddingHorizontal: 18, paddingBottom: 9, paddingTop: 9 },
});
