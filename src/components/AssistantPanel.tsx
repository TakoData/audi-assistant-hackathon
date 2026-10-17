import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AssistantPhase, TakoAnswer } from "../types";
import { KnowledgeCard } from "./KnowledgeCard";
import { Waveform } from "./Waveform";
import { AudiIcon } from "./AudiIcon";

type Props = {
  phase: AssistantPhase; title: string; question: string; transcript: string;
  result: TakoAnswer | null; error: string; inputLevel: number; voiceReady: boolean;
  onTalk: () => void; onReplay: () => void; onRetry: () => void;
  onAsk: (question: string) => void;
};

export function AssistantPanel(p: Props) {
  const [typing, setTyping] = useState(false);
  // Keep native text input authoritative: JS renders must not overwrite newer
  // Android keystrokes with an older controlled value during card rendering.
  const draft = useRef("");
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { scroll.current?.scrollTo({y:0, animated:false}); }, [p.question]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!typing) return false;
      Keyboard.dismiss(); setTyping(false); return true;
    });
    return () => subscription.remove();
  }, [typing]);
  const busy = p.phase === "thinking" || p.phase === "recovering";
  const listening = p.phase === "listening";
  const speaking = p.phase === "speaking";
  const leadCard = p.result?.cards[0];
  const idle = !p.result && !busy && !listening && !p.error && !p.question;
  const submit = () => { if (draft.current.trim() && !busy) { Keyboard.dismiss(); p.onAsk(draft.current); setTyping(false); draft.current = ""; } };
  return (
    <LinearGradient colors={["#49434F", "#2B282F", "#1B191F"]} start={{x:1,y:0}} end={{x:0,y:1}} style={s.panel}>
      {!leadCard && <View style={[s.header, idle && s.idleHeader]}>
        <View style={[s.headingRow, idle && s.idleHeadingRow]}>
          <AudiIcon name="mic" size={17} />
          <Text style={s.eyebrow}>Audi assistant</Text>
          {p.result && <Pressable onPress={speaking ? p.onTalk : p.onReplay} style={s.replay} accessibilityRole="button" accessibilityLabel={speaking ? "Stop spoken answer" : "Replay spoken answer"}>
            <AudiIcon name={speaking ? "stop-circle" : "volume-2"} size={18} />
            <Text style={s.replayText}>{speaking ? "Stop" : "Listen"}</Text>
          </Pressable>}
          <View style={[s.dot, (busy || listening || speaking) && s.dotActive]} />
        </View>
        {!idle && <Text style={[s.title, p.result && s.resultTitle]}>{p.result ? p.question : listening && !p.voiceReady ? "Starting microphone…" : p.title}</Text>}
        {!p.result && !!(listening ? p.transcript : p.question) && <Text numberOfLines={2} style={s.question}>{listening ? `“${p.transcript}”` : p.question}</Text>}
      </View>}
      <ScrollView ref={scroll} style={s.body} contentContainerStyle={[s.bodyContent, !!leadCard && s.cardBodyContent]} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
        {busy && <View style={s.progress}><ActivityIndicator color="#F0EBF3" /><Text style={s.secondary}>{p.phase === "recovering" ? "Restoring the connection…" : "Checking the latest information…"}</Text></View>}
        {!!p.error && <View style={s.error}><Text style={s.errorText}>{p.error}</Text><Pressable onPress={p.onRetry} style={s.retry} accessibilityRole="button"><Text style={s.retryText}>Try again</Text></Pressable></View>}
        {p.result ? <>
          {leadCard && <KnowledgeCard key={leadCard.id} card={leadCard} showTitle={false} />}
          <Text selectable style={[s.answer, !!leadCard && s.answerBelowCard]}>{p.result.answer}</Text>
        </> : listening && <View style={s.welcome}>
          <View style={s.voice}><Waveform active={listening && p.voiceReady} level={p.inputLevel} /></View>
          <Text style={s.welcomeTitle}>{p.voiceReady ? "Go ahead, I’m listening" : "Getting the microphone ready…"}</Text>
          <Text style={s.secondary}>{!p.voiceReady ? "Wait for “I’m listening” before speaking" : p.inputLevel > 0 ? "Audio detected" : "Speak now"}</Text>
        </View>}
      </ScrollView>
      {/* Tap the mounted editor to focus it. Android can retain a stale IME
          connection when autoFocus runs during a previous keyboard teardown. */}
      {typing && <View style={s.inputRow}><TextInput disableFullscreenUI defaultValue={draft.current} onChangeText={text => { draft.current = text; }} placeholder="Tap here to type your question" placeholderTextColor="#9AA7BC" style={s.input} onSubmitEditing={event => { draft.current = event.nativeEvent.text; submit(); }} returnKeyType="send" accessibilityLabel="Type your question" /><Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Send question" style={s.send}><MaterialCommunityIcons name="arrow-up" color="#fff" size={22}/></Pressable></View>}
      <View style={s.footer}>
        <Pressable disabled={busy} onPress={p.onTalk} accessibilityRole="button" accessibilityLabel={listening ? "Stop listening" : speaking ? "Stop spoken answer" : "Tap to talk"} style={[s.talk, (listening || speaking) && s.talkActive, busy && {opacity:0.55}]}>
          {busy ? <ActivityIndicator color="#252128"/> : <AudiIcon name={listening || speaking ? "square" : "mic"} color="#252128" size={21}/>}
          <Text style={s.talkText}>{listening ? (p.voiceReady ? "Finish speaking" : "Starting microphone…") : speaking ? "Stop reading" : "Tap to talk"}</Text>
        </Pressable>
        {!!leadCard && <Pressable onPress={speaking ? p.onTalk : p.onReplay} style={s.keyboard} accessibilityRole="button" accessibilityLabel={speaking ? "Stop spoken answer" : "Replay spoken answer"}>
          <AudiIcon name={speaking ? "stop-circle" : "volume-2"} size={23}/>
        </Pressable>}
        <Pressable disabled={busy} onPress={() => { Keyboard.dismiss(); setTyping(!typing); }} style={s.keyboard} accessibilityRole="button" accessibilityLabel="Type a question"><MaterialCommunityIcons name={typing ? "keyboard-close" : "keyboard-outline"} color="#DCE4F5" size={23}/></Pressable>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  panel: {flex:1, backgroundColor:"#29262E", borderRadius:12, borderWidth:1, borderColor:"#655D6C", overflow:"hidden"},
  header:{padding:12, borderBottomWidth:1, borderBottomColor:"#514B57"},
  idleHeader:{borderBottomWidth:0},idleHeadingRow:{marginBottom:0},
  headingRow:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:7},
  eyebrow:{color:"#F0ECF2",fontSize:13,fontWeight:"500",flex:1},
  dot:{width:5,height:5,borderRadius:3,backgroundColor:"#89818F"},dotActive:{backgroundColor:"#F3EFF6"},
  title:{color:"#FFFFFF",fontSize:23,lineHeight:28,fontWeight:"500",letterSpacing:-0.5},
  resultTitle:{fontSize:18,lineHeight:23,letterSpacing:-0.2},
  question:{color:"#CDC6D1",fontSize:12,lineHeight:17,marginTop:8},
  body:{flex:1},bodyContent:{padding:10,paddingBottom:12,flexGrow:1},
  cardBodyContent:{padding:0,paddingBottom:12},
  answerBelowCard:{paddingHorizontal:12,marginTop:14},
  label:{color:"#99ABC8",fontSize:9,fontWeight:"700",letterSpacing:1.5},
  answerHeading:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:9},
  replay:{flexDirection:"row",alignItems:"center",gap:6,padding:6},replayText:{color:"#EAE4EE",fontSize:11},
  answer:{color:"#F0F3FA",fontSize:14,lineHeight:20,marginBottom:12},
  progress:{gap:14,alignItems:"center",paddingVertical:40},
  welcome:{flex:1,justifyContent:"center"},voice:{alignItems:"center",paddingVertical:18},
  welcomeTitle:{color:"#F4F6FC",fontSize:21,lineHeight:27,marginBottom:10,fontWeight:"500"},
  secondary:{color:"#C8C0CE",fontSize:13,lineHeight:20},
  error:{padding:13,borderRadius:8,backgroundColor:"#38272E",marginBottom:14},errorText:{color:"#FFD3D0",fontSize:13,lineHeight:18},retry:{paddingTop:12},retryText:{color:"#FFFFFF",fontSize:13,fontWeight:"700"},
  footer:{flexDirection:"row",gap:8,padding:8,backgroundColor:"rgba(14,13,17,0.55)"},
  talk:{flex:1,height:48,borderRadius:24,backgroundColor:"#E9E4EB",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9},talkActive:{backgroundColor:"#C9BFD2"},talkText:{color:"#252128",fontSize:13,fontWeight:"500"},
  keyboard:{width:48,alignItems:"center",justifyContent:"center",borderRadius:24,borderWidth:1,borderColor:"#625969",backgroundColor:"#35303B"},
  inputRow:{flexDirection:"row",padding:10,gap:8,backgroundColor:"#35303B"},input:{flex:1,color:"#fff",fontSize:14},send:{width:40,alignItems:"center",justifyContent:"center"},
});
