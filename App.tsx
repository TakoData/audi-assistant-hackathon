import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  KeyboardAvoidingView,
  LogBox,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AssistantPanel } from "./src/components/AssistantPanel";
import { AudiIcon } from "./src/components/AudiIcon";
import { NavigationMap } from "./src/components/NavigationMap";
import { Waveform } from "./src/components/Waveform";
import { loadApiKey, removeApiKey, saveApiKey } from "./src/credentials";
import { askTako, checkRelay, userMessageForError, usesHostedRelay } from "./src/tako";
import type { AssistantPhase, TakoAnswer } from "./src/types";

LogBox.ignoreLogs(["Introspectable data is missing for class expo.modules.speechrecognition"]);

const SUGGESTIONS = [
  "How did Audi deliveries perform this month?",
  "What is the weather in Wolfsburg today?",
  "Compare EV sales in Europe and the US",
];

const phaseCopy: Record<AssistantPhase, string> = {
  off: "Tap to talk",
  armed: "Tap to talk",
  listening: "I’m listening…",
  thinking: "Finding a trusted answer",
  recovering: "Reconnecting securely…",
  speaking: "Here’s what I found",
  complete: "Tap to ask another",
  error: "Let’s try that again",
};

function currentTime() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
}

export default function App() {
  const [phase, setPhase] = useState<AssistantPhase>("off");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<TakoAnswer | null>(null);
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(-2);
  const [clock, setClock] = useState(currentTime());
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Array<{ name: string; ok: boolean; detail: string }>>([]);
  const [retryAction, setRetryAction] = useState<"listen" | "query" | "replay">("listen");
  const [lastRequestMeta, setLastRequestMeta] = useState("");
  const phaseRef = useRef<AssistantPhase>("off");
  const requestInFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const peakInputLevel = useRef(-2);
  const lastVoiceTranscript = useRef("");
  const glow = useRef(new Animated.Value(0)).current;

  const updatePhase = useCallback((next: AssistantPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(currentTime()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Android's speech engine is lazy and may take several seconds after a cold
  // launch. Warm it while the home screen loads, not after the first answer.
  useEffect(() => {
    void Speech.getAvailableVoicesAsync()
      .then(voices => console.info("AUDI_SPEECH_READY", voices.length))
      .catch(() => console.warn("AUDI_SPEECH_WARMUP_FAILED"));
  }, []);

  useEffect(() => {
    if (phase !== "listening" || voiceReady) return;
    const timer = setTimeout(() => {
      updatePhase("error");
      setError("The microphone did not become ready. Try again, or type your question.");
      setRetryAction("listen");
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
    }, 10_000);
    return () => clearTimeout(timer);
  }, [phase, voiceReady, updatePhase]);

  useEffect(() => {
    void loadApiKey()
      .then((savedKey) => {
        setApiKey(savedKey);
        setShowSetup(false);
      })
      .finally(() => setCredentialsLoaded(true));
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    if (phase === "listening" || phase === "thinking" || phase === "recovering") animation.start();
    else { animation.stop(); glow.setValue(0); }
    return () => animation.stop();
  }, [glow, phase]);

  useEffect(() => {
    const stopActiveWork = () => {
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
      void Speech.stop();
      activeRequest.current?.abort();
      activeRequest.current = null;
      requestInFlight.current = false;
      if (phaseRef.current === "listening" || phaseRef.current === "thinking" || phaseRef.current === "recovering") {
        updatePhase("armed");
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") stopActiveWork();
    });
    return () => {
      subscription.remove();
      stopActiveWork();
    };
  }, [updatePhase]);

  const startListening = useCallback(async () => {
    if (requestInFlight.current || phaseRef.current === "thinking") return;
    if (!usesHostedRelay && !apiKey) {
      setError("Assistant setup is incomplete. Ask the demo administrator for help.");
      updatePhase("error");
      return;
    }
    setError("");
    setTranscript("");
    setVoiceReady(false);
    lastVoiceTranscript.current = "";
    setInputLevel(-2);
    peakInputLevel.current = -2;

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Speech recognition is unavailable on this Android device. Check Google Speech Services.");
      setRetryAction("listen");
      updatePhase("error");
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError("Please allow microphone access so Audi Assistant can hear you.");
      setRetryAction("listen");
      updatePhase("error");
      return;
    }

    setVoiceEnabled(true);
    setResult(null);
    setQuestion("");
    updatePhase("listening");
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: ["Audi", "Wolfsburg", "Ingolstadt"],
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: "web_search" },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });
    } catch (recognitionError) {
      setError(recognitionError instanceof Error ? recognitionError.message : "Voice recognition is unavailable.");
      setRetryAction("listen");
      updatePhase("error");
    }
  }, [apiKey, updatePhase]);

  const speakAnswer = useCallback(async (text: string) => {
    setError("");
    // `stop` is asynchronous on Android. Waiting prevents it from cancelling
    // the new utterance that follows immediately after a Tako response.
    const withDeadline = async <T,>(work: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Speech service did not respond")), 8000); })]); }
      finally { if(timer) clearTimeout(timer); }
    };
    let voices: Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>> = [];
    try {
      await withDeadline(Speech.stop());
      voices = await withDeadline(Speech.getAvailableVoicesAsync());
    } catch {
      requestInFlight.current = false;
      setError("Your answer is ready. Audio is temporarily unavailable; tap the speaker or Try again.");
      setRetryAction("replay");
      updatePhase("complete");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (voices.length === 0) {
      requestInFlight.current = false;
      setError("The answer is on screen, but Android text-to-speech is unavailable.");
      setRetryAction("replay");
      updatePhase("complete");
      return;
    }
    updatePhase("speaking");
    Speech.speak(text, {
      language: "en-US",
      rate: 0.92,
      pitch: 0.98,
      volume: 1,
      onStart: () => console.info("AUDI_SPEECH_STARTED"),
      onDone: () => {
        console.info("AUDI_SPEECH_FINISHED");
        requestInFlight.current = false;
        updatePhase("complete");
      },
      onStopped: () => {
        requestInFlight.current = false;
        updatePhase("complete");
      },
      onError: () => {
        requestInFlight.current = false;
        setError("The answer is on screen, but Android could not read it aloud. Tap Replay.");
        setRetryAction("replay");
        updatePhase("error");
      },
    });
  }, [updatePhase]);

  const ask = useCallback(async (rawQuestion: string) => {
    const cleanQuestion = rawQuestion.trim().replace(/[.?!]+$/, "");
    if (!cleanQuestion || requestInFlight.current) return;

    requestInFlight.current = true;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setQuestion(cleanQuestion);
    setTranscript(cleanQuestion);
    setResult(null);
    setError("");
    setRetryAction("listen");
    updatePhase("thinking");
    try { ExpoSpeechRecognitionModule.abort(); } catch {}

    try {
      if (!usesHostedRelay && !apiKey) {
        throw new Error("Add an API key before asking a question.");
      }
      const answer = await askTako(cleanQuestion, apiKey, {
        signal: controller.signal,
        onRetry: () => updatePhase("recovering"),
      });
      if (generation !== requestGeneration.current) return;
      setResult(answer);
      updatePhase("complete");
      console.info("AUDI_DEMO_ANSWER_COMPLETE", JSON.stringify({
        requestId: answer.requestId ?? "unavailable",
        cards: answer.cards.length,
        elapsedMs: answer.elapsedMs ?? null,
        attempts: answer.attemptCount ?? null,
      }));
      setLastRequestMeta([
        answer.requestId ? `Request ${answer.requestId}` : "Request ID unavailable",
        answer.elapsedMs != null ? `${(answer.elapsedMs / 1000).toFixed(1)}s` : "",
        answer.attemptCount ? `${answer.attemptCount} attempt${answer.attemptCount === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" • "));
      void speakAnswer(answer.answer);
    } catch (askError) {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      requestInFlight.current = false;
      activeRequest.current = null;
      console.error("AUDI_DEMO_ANSWER_FAILED", userMessageForError(askError));
      setError(userMessageForError(askError));
      setRetryAction("query");
      updatePhase("error");
    }
  }, [apiKey, speakAnswer, updatePhase]);

  const runDiagnostics = useCallback(async () => {
    if (diagnosticsRunning) return;
    setDiagnosticsRunning(true);
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const add = (name: string, ok: boolean, detail: string) => {
      checks.push({ name, ok, detail });
      setDiagnostics([...checks]);
    };

    try {
      add("Speech service", ExpoSpeechRecognitionModule.isRecognitionAvailable(), ExpoSpeechRecognitionModule.isRecognitionAvailable() ? "Available" : "Unavailable");
      const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      add("Microphone", permission.granted, permission.granted ? "Permission granted" : "Permission required");
      const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
      add("Spoken audio", voices.length > 0, voices.length > 0 ? `${voices.length} Android voice${voices.length === 1 ? "" : "s"} available` : "No TTS voice installed");
      const relay = await checkRelay();
      add("Demo relay", relay.ok && relay.configured !== false, relay.ok ? `Online in ${relay.elapsedMs} ms` : "Unavailable");
      const live = await askTako("What is Audi's parent company?", apiKey, { attemptTimeouts: [18_000] });
      add("Live answer", Boolean(live.answer), `${live.cards.length} card${live.cards.length === 1 ? "" : "s"} • ${((live.elapsedMs ?? 0) / 1000).toFixed(1)}s`);
      add("Last voice input", Boolean(lastVoiceTranscript.current && peakInputLevel.current > 0), lastVoiceTranscript.current ? `Heard “${lastVoiceTranscript.current.slice(0, 45)}”` : "Tap Test microphone and speak");
    } catch (diagnosticError) {
      add("Live connection", false, userMessageForError(diagnosticError));
    } finally {
      setDiagnosticsRunning(false);
    }
  }, [apiKey, diagnosticsRunning]);

  const storeApiKey = useCallback(async () => {
    const cleanKey = apiKeyDraft.trim();
    if (cleanKey.length < 12 || /\s/.test(cleanKey)) {
      setSetupError("Paste the complete API key without spaces.");
      return;
    }
    try {
      await saveApiKey(cleanKey);
      const persistedKey = await loadApiKey();
      if (persistedKey !== cleanKey) {
        throw new Error("The saved key could not be read back.");
      }
      setApiKey(cleanKey);
      setApiKeyDraft("");
      setSetupError("");
      setShowApiKey(false);
      setShowSetup(false);
      setError("");
      updatePhase("off");
    } catch {
      setSetupError("Android could not save the key securely. Please try again.");
    }
  }, [apiKeyDraft, updatePhase]);

  const forgetApiKey = useCallback(async () => {
    await removeApiKey();
    setApiKey(null);
    setApiKeyDraft("");
    setSetupError("");
    setResult(null);
    setQuestion("");
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (phaseRef.current !== "listening") return;
    setVoiceReady(true);
    console.info("AUDI_MIC_READY");
  });

  useSpeechRecognitionEvent("speechstart", () => console.info("AUDI_MIC_SPEECH_DETECTED"));

  useSpeechRecognitionEvent("result", (event) => {
    const heard = event.results[0]?.transcript?.trim() ?? "";
    if (!heard || requestInFlight.current) return;
    setTranscript(heard);
    lastVoiceTranscript.current = heard;
    if (!event.isFinal) return;

    if (phaseRef.current === "listening") void ask(heard);
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    setInputLevel(event.value);
    peakInputLevel.current = Math.max(peakInputLevel.current, event.value);
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted" || requestInFlight.current) return;
    const message = event.error === "no-speech"
      ? "I didn’t hear anything. Tap the microphone and try again."
      : event.error === "not-allowed"
        ? "Microphone access is off. Allow it in Android Settings, then tap Retry."
        : event.message || "Voice recognition stopped. Tap Retry to try again.";
    setError(message);
    console.warn("AUDI_MIC_ERROR", event.error);
    setRetryAction("listen");
    updatePhase("error");
  });

  useSpeechRecognitionEvent("end", () => {
    console.info("AUDI_MIC_SESSION_END", JSON.stringify({peakLevel:peakInputLevel.current, recognized:!!lastVoiceTranscript.current}));
    setVoiceReady(false);
    setInputLevel(-2);
    if (!requestInFlight.current && phaseRef.current === "listening") {
      updatePhase("armed");
    }
  });

  const stopListening = () => {
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
  };

  const stopSpeaking = () => {
    Speech.stop();
    requestInFlight.current = false;
    updatePhase("complete");
  };

  const leadCard = result?.cards[0];
  const active = phase === "listening" || phase === "thinking" || phase === "recovering" || phase === "speaking";

  return (
    <LinearGradient colors={["#514C55", "#29272E", "#09090B"]} locations={[0, 0.48, 1]} start={{x:1,y:0}} end={{x:0.25,y:1}} style={styles.app}>
      <StatusBar hidden />
      <View style={styles.safe}>
        <View style={styles.idLight}>
          <Animated.View style={[styles.idLightActive, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />
        </View>

        <View style={styles.topbar}>
          <Pressable
            style={styles.brandGroup}
            onLongPress={() => {
              setShowDiagnostics(true);
              void runDiagnostics();
            }}
            delayLongPress={1200}
            accessibilityRole="image"
            accessibilityLabel="Audi"
          >
            <View style={styles.audiRings}>
              {[0, 1, 2, 3].map((ring) => <View key={ring} style={[styles.audiRing, { left: ring * 13 }]} />)}
            </View>
            <Text style={styles.brand}>AUDI</Text>
          </Pressable>
          <View style={styles.routePill}>
            <AudiIcon name="navigation" size={16} />
            <Text style={styles.routeText}>Wolfsburg • Autostadt</Text>
          </View>
          <View style={styles.systemGroup}>
            <AudiIcon name="bar-chart" size={17} />
            <AudiIcon name="bluetooth" size={16} />
            <Text style={styles.temperature}>20.5°</Text>
            <Text style={styles.clock}>{clock}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.shortcutRail}>
            <AudiIcon name="home" />
            <View style={styles.railSelected}><AudiIcon name="mic" size={22}/></View>
            <AudiIcon name="navigation" />
            <AudiIcon name="radio" />
            <AudiIcon name="smartphone" />
            <View style={{flex:1}}/>
            <AudiIcon name="grid" size={22}/>
            <Pressable onPress={() => { setShowDiagnostics(true); void runDiagnostics(); }} accessibilityRole="button" accessibilityLabel="Connection diagnostics"><AudiIcon name="settings" size={22}/></Pressable>
          </View>
          <View style={{width:"33%", alignSelf:"stretch"}}>
            <AssistantPanel phase={phase} title={phaseCopy[phase]} question={question} transcript={transcript}
              result={result} error={error} inputLevel={inputLevel} voiceReady={voiceReady}
              onTalk={() => {
                if (phase === "speaking") stopSpeaking();
                else if (phase === "listening") stopListening();
                else if (phase !== "thinking" && phase !== "recovering") void startListening();
              }}
              onReplay={() => { if(result) void speakAnswer(result.answer); }}
              onRetry={() => retryAction === "replay" && result ? void speakAnswer(result.answer) : retryAction === "query" && question ? void ask(question) : void startListening()}
              onAsk={q => { void (async () => { await Speech.stop(); requestInFlight.current = false; await ask(q); })(); }}
            />
          </View>
          <View style={styles.visualPanel}><NavigationMap /></View>
        </View>

        <View style={styles.climateBar}>
          <MaterialCommunityIcons name="car-seat-heater" size={21} color="#E9E6EA" />
          <AudiIcon name="minus" size={17} color="#92B5E5" />
          <Text style={styles.climateTemp}>20.5°</Text>
          <AudiIcon name="plus" size={17} color="#E57C86" />
          <Text style={styles.auto}>AUTO</Text>
          <Text style={styles.auto}>A/C</Text>
          <View style={styles.climateSpacer} />
          <MaterialCommunityIcons name="fan" size={22} color="#E9E6EA" />
          <MaterialCommunityIcons name="car-defrost-front" size={22} color="#E9E6EA" />
          <MaterialCommunityIcons name="car-defrost-rear" size={22} color="#E9E6EA" />
          <View style={styles.climateSpacer} />
          <Text style={styles.auto}>SYNC</Text>
          <AudiIcon name="minus" size={17} color="#92B5E5" />
          <Text style={styles.climateTemp}>20.5°</Text>
          <AudiIcon name="plus" size={17} color="#E57C86" />
          <MaterialCommunityIcons name="car-seat-heater" size={21} color="#E9E6EA" />
        </View>
      </View>

      <Modal visible={showDiagnostics} transparent animationType="fade" onRequestClose={() => setShowDiagnostics(false)}>
        <View style={styles.diagnosticsBackdrop}>
          <View style={styles.diagnosticsCard}>
            <View style={styles.diagnosticsHeader}>
              <View>
                <Text style={styles.setupEyebrow}>DEMO READINESS</Text>
                <Text style={styles.diagnosticsTitle}>Audi Assistant check</Text>
              </View>
              <Pressable onPress={() => setShowDiagnostics(false)} style={styles.diagnosticsClose}>
                <MaterialCommunityIcons name="close" color="#DCE4E1" size={24} />
              </Pressable>
            </View>
            <View style={styles.diagnosticsList}>
              {diagnostics.length === 0 && <Text style={styles.diagnosticsEmpty}>Preparing checks…</Text>}
              {diagnostics.map((item) => (
                <View key={item.name} style={styles.diagnosticRow}>
                  <MaterialCommunityIcons name={item.ok ? "check-circle" : "alert-circle"} color={item.ok ? "#5EE6B0" : "#FFB79F"} size={20} />
                  <Text style={styles.diagnosticName}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.diagnosticDetail}>{item.detail}</Text>
                </View>
              ))}
            </View>
            <View style={styles.diagnosticsActions}>
              {!usesHostedRelay && (
                <Pressable onPress={() => { setShowDiagnostics(false); setShowSetup(true); }} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Data access</Text>
                </Pressable>
              )}
              <Pressable onPress={() => { setShowDiagnostics(false); void startListening(); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Test microphone</Text>
              </Pressable>
              <Pressable disabled={diagnosticsRunning} onPress={() => void runDiagnostics()} style={styles.runCheckButton}>
                {diagnosticsRunning ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.runCheckText}>Run again</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={credentialsLoaded && showSetup} transparent animationType="fade" onRequestClose={() => setShowSetup(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.setupBackdrop}
        >
          <ScrollView
            style={styles.setupScroll}
            contentContainerStyle={styles.setupScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <MaterialCommunityIcons name="key-variant" color="#FFFFFF" size={29} />
            </View>
            <Text allowFontScaling={false} style={styles.setupEyebrow}>ADMINISTRATOR SETUP</Text>
            <Text allowFontScaling={false} style={styles.setupTitle}>{apiKey ? "Data access settings" : "Configure data access"}</Text>
            <Text allowFontScaling={false} style={styles.setupCopy}>
              {apiKey
                ? "An API key is saved securely on this device. Replace it or remove it before handing the device to someone else."
                : "Paste your Tako API key. It stays encrypted on this Android device and is sent only to Tako when you ask a question."}
            </Text>

            <View style={styles.keyField}>
              <MaterialCommunityIcons name="shield-key-outline" color="#7B8C94" size={20} />
              <TextInput
                value={apiKeyDraft}
                onChangeText={(value) => { setApiKeyDraft(value); setSetupError(""); }}
                placeholder={apiKey ? "Paste a replacement key" : "Paste API key"}
                placeholderTextColor="#66777E"
                secureTextEntry={!showApiKey}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="visible-password"
                style={styles.keyInput}
                accessibilityLabel="Tako API key"
              />
              <Pressable onPress={() => setShowApiKey((visible) => !visible)} style={styles.revealButton}>
                <MaterialCommunityIcons name={showApiKey ? "eye-off-outline" : "eye-outline"} color="#AFC0C7" size={20} />
              </Pressable>
            </View>
            {!!setupError && <Text style={styles.setupError}>{setupError}</Text>}

            <View style={styles.setupActions}>
              {apiKey && (
                <Pressable onPress={() => void forgetApiKey()} style={styles.removeKeyButton}>
                  <Text style={styles.removeKeyText}>Remove key</Text>
                </Pressable>
              )}
              {apiKey && (
                <Pressable onPress={() => setShowSetup(false)} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              )}
              <Pressable onPress={() => void storeApiKey()} style={[styles.saveKeyButton, !apiKeyDraft.trim() && styles.saveKeyButtonDisabled]} disabled={!apiKeyDraft.trim()}>
                <Text style={styles.saveKeyText}>{apiKey ? "Replace key" : "Save and continue"}</Text>
                <MaterialCommunityIcons name="arrow-right" color="#FFFFFF" size={19} />
              </Pressable>
            </View>
            <Text style={styles.setupFootnote}>Administrators can return here by long-pressing the Audi logo.</Text>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  ambientGlow: { position: "absolute", top: -180, left: -100, width: 620, height: 420, borderRadius: 310, backgroundColor: "rgba(93,123,205,0.08)", shadowColor: "#E20015", shadowOpacity: 0.12, shadowRadius: 80 },
  safe: { flex: 1, paddingHorizontal: 16, paddingBottom: 4 },
  idLight: { height: 2, marginHorizontal: -16, backgroundColor: "rgba(255,255,255,0.04)" },
  idLightActive: { height: 1, width: "36%", alignSelf: "center", backgroundColor: "#E3DCE8" },
  topbar: { height: 55, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandGroup: { flexDirection: "row", alignItems: "center", gap: 11, width: 220 },
  audiRings: { position: "relative", width: 59, height: 23 },
  audiRing: { position: "absolute", top: 1, width: 22, height: 22, borderRadius: 11, borderWidth: 1.6, borderColor: "#F1F1F1" },
  brand: { color: "#F4F4F4", fontSize: 13, fontWeight: "700", letterSpacing: 2.4 },
  routePill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", paddingHorizontal: 15, paddingVertical: 7 },
  routeText: { color: "#E8E5E9", fontSize: 12, fontWeight: "500" },
  systemGroup: { width: 220, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  temperature: { color: "#E8E5E9", fontSize: 12, fontWeight: "500" },
  clock: { color: "#F4F3F5", fontSize: 13, fontWeight: "500", marginLeft: 4 },
  content: { flex: 1, flexDirection: "row", gap: 10, minHeight: 0 },
  shortcutRail: { width: 44, paddingVertical: 17, alignItems: "center", gap: 26, borderRadius: 23, backgroundColor: "#0D0C10" },
  railSelected: { padding: 9, borderRadius: 21, backgroundColor: "#504B56", borderWidth: 1, borderColor: "#89818E" },
  assistantPanel: { width: "43%", borderRadius: 3, backgroundColor: "rgba(20,20,20,0.97)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: 24, justifyContent: "space-between" },
  knowledgeColumn: { width: "43%", minWidth: 0, borderRadius: 3, overflow: "hidden", backgroundColor: "#141414", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  resultControl: { minHeight: 92, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" },
  resultCopy: { flex: 1, minWidth: 0, paddingRight: 14 },
  resultPhase: { color: "#F4F4F4", fontSize: 20, lineHeight: 24, fontWeight: "500", letterSpacing: -0.35 },
  compactOrb: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#303030", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  compactOrbActive: { backgroundColor: "#E20015", borderColor: "#FF4A58" },
  cardFrame: { flex: 1, minHeight: 0 },
  resultFooter: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", backgroundColor: "#101010" },
  resultAnswer: { flex: 1, color: "#D4D4D4", fontSize: 12, lineHeight: 17 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: "#59615F" },
  statusDotActive: { backgroundColor: "#E20015", shadowColor: "#E20015", shadowOpacity: 1, shadowRadius: 8 },
  eyebrow: { color: "#8D9996", fontSize: 10, fontWeight: "800", letterSpacing: 1.7 },
  phaseTitle: { color: "#F5F8F7", fontSize: 27, lineHeight: 32, fontWeight: "500", letterSpacing: -0.7 },
  hint: { color: "#87928F", fontSize: 14, lineHeight: 20, marginTop: 11, maxWidth: 360 },
  transcript: { color: "#B9C5C1", fontSize: 16, lineHeight: 23, marginTop: 12 },
  question: { color: "#899592", fontSize: 13, lineHeight: 19, marginTop: 10 },
  voiceCenter: { flexDirection: "row", alignItems: "center", gap: 24 },
  micStatus: { color: "#8D9996", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginTop: -6 },
  orb: { height: 76, width: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  orbActive: { backgroundColor: "#E20015", borderColor: "#FF4A58", shadowColor: "#E20015", shadowOpacity: 0.35, shadowRadius: 22, elevation: 10 },
  orbPressed: { transform: [{ scale: 0.96 }] },
  enableButton: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 2, backgroundColor: "#E20015" },
  enableButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  suggestions: { gap: 8 },
  suggestion: { height: 43, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, backgroundColor: "rgba(255,255,255,0.045)", paddingHorizontal: 14 },
  suggestionText: { color: "#B3BEBA", fontSize: 12, flex: 1, marginRight: 10 },
  answerBox: { minWidth: 0, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 15 },
  answerLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  answerLabel: { color: "#FF4A58", fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  nowSpeaking: { color: "#8D9996", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 },
  replayButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, marginVertical: -4 },
  answerText: { color: "#DCE4E1", fontSize: 14, lineHeight: 20 },
  requestMeta: { color: "#617783", fontSize: 8, marginTop: 6 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 14, padding: 12, backgroundColor: "rgba(255,105,75,0.1)" },
  errorText: { color: "#FFCEBF", fontSize: 12, flex: 1 },
  retry: { color: "#FF4A58", fontSize: 12, fontWeight: "800" },
  visualPanel: { flex: 1, minWidth: 0, paddingRight: 2 },
  mapShell: { flex: 1, borderRadius: 3, overflow: "hidden", backgroundColor: "#111111", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  mapGrid: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.28, borderWidth: 44, borderColor: "#202020" },
  road: { position: "absolute", height: 8, borderRadius: 2, backgroundColor: "#3A3A3A", transform: [{ rotate: "-18deg" }] },
  roadOne: { width: "120%", left: "-10%", top: "47%" },
  roadTwo: { width: "75%", left: "28%", top: "24%", transform: [{ rotate: "54deg" }] },
  roadThree: { width: "70%", left: "-14%", top: "74%", transform: [{ rotate: "31deg" }] },
  destinationPin: { position: "absolute", left: "58%", top: "31%", height: 50, width: 50, borderRadius: 25, backgroundColor: "#E20015", alignItems: "center", justifyContent: "center", shadowColor: "#E20015", shadowOpacity: 0.3, shadowRadius: 18 },
  mapInfo: { position: "absolute", left: 22, bottom: 20, borderRadius: 3, backgroundColor: "rgba(5,5,5,0.94)", borderLeftWidth: 3, borderLeftColor: "#E20015", paddingHorizontal: 18, paddingVertical: 14, minWidth: 220 },
  mapEta: { color: "#FFFFFF", fontSize: 25, fontWeight: "500" },
  mapDestination: { color: "#EFF4F2", fontSize: 14, fontWeight: "700", marginTop: 3 },
  mapMeta: { color: "#899592", fontSize: 11, marginTop: 4 },
  safetyBadge: { position: "absolute", top: 18, right: 18, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(5,5,5,0.9)", borderRadius: 2, paddingHorizontal: 12, paddingVertical: 9 },
  safetyText: { color: "#C5CFCC", fontSize: 11, fontWeight: "600" },
  climateBar: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  climateTemp: { color: "#F5F2F5", fontSize: 19, fontWeight: "500" },
  auto: { color: "#E2DDE4", fontSize: 11, fontWeight: "500", letterSpacing: 0.3 },
  climateSpacer: { width: 15 },
  fanLevel: { width: 90, height: 3, borderRadius: 3, backgroundColor: "#39413F" },
  fanLevelActive: { width: "58%", height: 3, borderRadius: 3, backgroundColor: "#ADC6FF" },
  setupBackdrop: { flex: 1, backgroundColor: "rgba(0,7,12,0.88)" },
  setupScroll: { flex: 1, width: "100%" },
  setupScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  setupCard: { width: "58%", maxWidth: 650, minWidth: 520, borderRadius: 28, padding: 30, backgroundColor: "#091A25", borderWidth: 1, borderColor: "rgba(97,214,255,0.22)", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 28, elevation: 22 },
  setupIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: "#E20015", marginBottom: 18 },
  setupEyebrow: { color: "#FF4A58", fontSize: 10, fontWeight: "900", letterSpacing: 1.8, marginBottom: 8 },
  setupTitle: { color: "#F5F8F7", fontSize: 27, lineHeight: 32, fontWeight: "600", letterSpacing: -0.6 },
  setupCopy: { color: "#A9B8BC", fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 20, maxWidth: 560 },
  keyField: { height: 54, flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1, borderColor: "rgba(175,192,199,0.25)", backgroundColor: "#06131C", paddingLeft: 15 },
  keyInput: { flex: 1, color: "#F2F7F8", fontSize: 15, marginLeft: 10, paddingVertical: 0 },
  revealButton: { width: 50, height: 52, alignItems: "center", justifyContent: "center" },
  setupError: { color: "#FFB79F", fontSize: 12, marginTop: 9 },
  setupActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  removeKeyButton: { paddingHorizontal: 5, paddingVertical: 12, marginRight: "auto" },
  removeKeyText: { color: "#FFB79F", fontSize: 13, fontWeight: "700" },
  cancelButton: { paddingHorizontal: 17, paddingVertical: 13, borderRadius: 13 },
  cancelText: { color: "#C6CFCC", fontSize: 13, fontWeight: "700" },
  saveKeyButton: { minWidth: 170, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 2, backgroundColor: "#E20015", paddingHorizontal: 18 },
  saveKeyButtonDisabled: { opacity: 0.38 },
  saveKeyText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  setupFootnote: { color: "#70828A", fontSize: 10, marginTop: 15, textAlign: "right" },
  diagnosticsBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0,7,12,0.9)" },
  diagnosticsCard: { width: "58%", minWidth: 560, borderRadius: 26, padding: 28, backgroundColor: "#091A25", borderWidth: 1, borderColor: "rgba(97,214,255,0.25)" },
  diagnosticsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  diagnosticsTitle: { color: "#F5F8F7", fontSize: 25, fontWeight: "600" },
  diagnosticsClose: { padding: 8, marginTop: -8, marginRight: -8 },
  diagnosticsList: { gap: 8, minHeight: 220 },
  diagnosticsEmpty: { color: "#91A2A8", paddingVertical: 28, textAlign: "center" },
  diagnosticRow: { height: 42, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.035)" },
  diagnosticName: { color: "#E6EEEB", width: 120, fontSize: 13, fontWeight: "700" },
  diagnosticDetail: { color: "#93A5AA", flex: 1, fontSize: 12, textAlign: "right" },
  diagnosticsActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  secondaryButton: { height: 44, justifyContent: "center", borderRadius: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(175,192,199,0.22)" },
  secondaryButtonText: { color: "#C8D3D0", fontSize: 12, fontWeight: "700" },
  runCheckButton: { minWidth: 120, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 2, backgroundColor: "#E20015", paddingHorizontal: 18 },
  runCheckText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
