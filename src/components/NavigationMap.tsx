import { AudiIcon } from "./AudiIcon";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { mapScript, mapStyle } from "../mapAssets";

// A real interactive street map, centered on the demo location. No device GPS is sent.
const MAP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>
${mapStyle}
html,body,#map{margin:0;width:100%;height:100%;background:#252329}
.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) saturate(.12) brightness(1.12)}
.leaflet-control-zoom a{background:#29252e!important;color:white!important;border-color:#5c5562!important;width:42px!important;height:42px!important;line-height:42px!important;font-weight:400!important}
.leaflet-control-attribution{background:rgba(22,20,26,.94)!important;color:#d3cdd8!important;padding:5px 9px!important}
.leaflet-control-attribution a{color:#eee8f2!important}
.leaflet-control-zoom{margin-top:102px!important;margin-right:18px!important}
.demo-position{background:#eee7f2;border:2px solid white;border-radius:50%;box-shadow:0 0 0 10px #e5d8f026,0 2px 10px #0008;display:flex;align-items:center;justify-content:center;color:#37303e;font-size:25px}
</style></head><body><div id="map"></div><script>${mapScript.replace(/<\/script/gi, "<\\/script")}</script><script>
var map = window.demoMap = L.map('map', {zoomControl:false, minZoom:10, maxZoom:18}).setView([52.4265,10.789],13);
L.control.zoom({position:'topright'}).addTo(map);
var loaded = false;
var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:19, keepBuffer:0, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
});
tiles.on('tileload',function(){if(!loaded){loaded=true;window.ReactNativeWebView.postMessage('map-ready');}});
tiles.on('load',function(){if(!loaded)window.ReactNativeWebView.postMessage('map-error');});
tiles.addTo(map);
L.marker([52.4227,10.7865],{icon:L.divIcon({className:'demo-position',html:'&#9650;',iconSize:[36,36],iconAnchor:[18,18]})}).addTo(map);
window.addEventListener('resize',function(){map.invalidateSize();});
</script></body></html>`;
const MAP_SOURCE = { html: MAP_HTML, baseUrl: "https://vw-assistant-demo.vercel.app" };

export function NavigationMap() {
  const ref = useRef<WebView>(null);
  const [status, setStatus] = useState("loading");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setStatus(s => s === "loading" ? "error" : s), 25000);
    return () => clearTimeout(timer);
  }, [generation]);
  const reload = () => { setStatus("loading"); setGeneration(g => g + 1); };
  return <View style={s.shell}>
    <WebView ref={ref} key={generation} source={MAP_SOURCE} style={s.web} cacheEnabled
      applicationNameForUserAgent="AudiAssistantPrototype/1.4 (vw-assistant-demo.vercel.app)"
      javaScriptEnabled domStorageEnabled originWhitelist={["https://*", "about:*"]}
      onMessage={event => { const ready = event.nativeEvent.data === "map-ready"; setStatus(ready ? "ready" : "error"); console.info(ready ? "AUDI_MAP_READY" : "AUDI_MAP_FAILED"); }}
      onError={() => setStatus("error")} onHttpError={() => setStatus("error")}
      onShouldStartLoadWithRequest={request => {
        if (request.url.startsWith("https://vw-assistant-demo.vercel.app") || request.url === "about:blank") return true;
        if (request.url.startsWith("https://")) void Linking.openURL(request.url);
        return false;
      }}
    />
    <View style={s.search} pointerEvents="none"><AudiIcon name="search" size={21}/><View><Text style={s.place}>Wolfsburg</Text><Text style={s.caption}>Explore the area</Text></View></View>
    <Pressable style={s.recenter} onPress={() => status === "ready" ? ref.current?.injectJavaScript("window.demoMap.setView([52.4265,10.789],13);true;") : reload()} accessibilityRole="button" accessibilityLabel="Recenter map"><AudiIcon name="crosshair" size={23}/></Pressable>
    <View style={s.destination} pointerEvents="none"><AudiIcon name="map-pin" size={24}/><View><Text style={s.place}>Autostadt</Text><Text style={s.caption}>Wolfsburg · demo location</Text></View><View style={s.live}><Text style={s.liveText}>MAP</Text></View></View>
    {status !== "ready" && <View style={s.notice}>
      {status === "loading" ? <><ActivityIndicator color="#ECE5F1"/><Text style={s.noticeText}>Loading street map…</Text></> : <><Text style={s.noticeText}>The map connection is unavailable.</Text><Pressable onPress={reload} style={s.retry}><Text style={s.retryText}>Reload map</Text></Pressable></>}
    </View>}
  </View>;
}

const s = StyleSheet.create({
  shell:{flex:1,borderRadius:12,overflow:"hidden",backgroundColor:"#252329",borderWidth:1,borderColor:"#655D6C"},web:{flex:1,backgroundColor:"#252329"},
  search:{position:"absolute",top:12,left:12,width:240,backgroundColor:"rgba(43,39,48,.96)",borderWidth:1,borderColor:"#746B7D",borderRadius:30,paddingHorizontal:16,paddingVertical:10,flexDirection:"row",alignItems:"center",gap:12},
  place:{color:"#F4F0F6",fontSize:16,fontWeight:"500"},caption:{color:"#C9C1CF",fontSize:11,marginTop:3},
  recenter:{position:"absolute",right:12,top:12,width:44,height:48,borderRadius:24,alignItems:"center",justifyContent:"center",backgroundColor:"#29252E",borderWidth:1,borderColor:"#746B7D"},
  destination:{position:"absolute",left:12,bottom:30,padding:12,borderRadius:12,flexDirection:"row",alignItems:"center",gap:10,backgroundColor:"rgba(31,28,35,.96)",borderWidth:1,borderColor:"#746B7D"},
  live:{marginLeft:16,padding:6,borderRadius:4,backgroundColor:"#49414F"},liveText:{color:"#E6DFEB",fontSize:9,letterSpacing:1},
  notice:{position:"absolute",alignSelf:"center",top:"45%",borderRadius:10,padding:18,gap:12,alignItems:"center",backgroundColor:"#302A36"},noticeText:{color:"#ECE6F1",fontSize:14},retry:{padding:10},retryText:{color:"#ECE6F1",fontWeight:"600"},
});
