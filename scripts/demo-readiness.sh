#!/bin/zsh

set -eu

PROJECT_DIR="${0:A:h:h}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
RELAY_URL="${VW_DEMO_RELAY_URL:-https://vw-assistant-demo.vercel.app}"
ARTIFACT_DIR="$PROJECT_DIR/artifacts/rehearsal-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$ARTIFACT_DIR"
REPORT="$ARTIFACT_DIR/report.txt"
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  print "PASS  $1" | tee -a "$REPORT"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  print "FAIL  $1" | tee -a "$REPORT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

print "Audi Assistant demo readiness — $(date)" | tee "$REPORT"
print "" | tee -a "$REPORT"

if [ ! -x "$ADB" ]; then
  fail "Android SDK / adb not found at $ADB"
  exit 1
fi

if "$ADB" get-state >/dev/null 2>&1; then
  pass "Android device or emulator connected"
else
  fail "No Android device or emulator connected"
  exit 1
fi

if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
  pass "Android finished booting"
else
  fail "Android has not finished booting"
fi

if "$ADB" shell pm path com.tako.volkswagen.demo >/dev/null 2>&1; then
  pass "Volkswagen Assistant is installed"
else
  fail "Volkswagen Assistant is not installed"
  exit 1
fi

MIC_PERMISSION="$("$ADB" shell dumpsys package com.tako.volkswagen.demo | sed -n '/android.permission.RECORD_AUDIO/{n;p;}' | head -1)"
if print "$MIC_PERMISSION" | rg -q 'granted=true'; then
  pass "Microphone permission granted"
else
  "$ADB" shell pm grant com.tako.volkswagen.demo android.permission.RECORD_AUDIO >/dev/null 2>&1 || true
  if "$ADB" shell dumpsys package com.tako.volkswagen.demo | rg -q 'android.permission.RECORD_AUDIO: granted=true'; then
    pass "Microphone permission restored"
  else
    fail "Microphone permission unavailable"
  fi
fi

if "$ADB" shell ping -c 1 -W 3 vw-assistant-demo.vercel.app >/dev/null 2>&1; then
  pass "Android DNS and internet connection"
else
  fail "Android cannot resolve the demo relay (DNS/network)"
fi

HEALTH_FILE="$ARTIFACT_DIR/relay-health.json"
if curl -fsS --max-time 8 "$RELAY_URL/health" -o "$HEALTH_FILE"; then
  if rg -q '"ok"\s*:\s*true' "$HEALTH_FILE"; then
    pass "Hosted relay health endpoint"
  else
    fail "Relay answered but did not report healthy"
  fi
else
  fail "Hosted relay is unreachable"
fi

"$ADB" logcat -c
"$ADB" logcat -s ReactNativeJS:I > "$ARTIFACT_DIR/app-events.log" 2>&1 &
LOG_PID=$!
trap 'kill "$LOG_PID" 2>/dev/null || true' EXIT
"$ADB" shell am force-stop com.tako.volkswagen.demo
"$ADB" shell am start -n com.tako.volkswagen.demo/.MainActivity >/dev/null
sleep 3
"$ADB" exec-out screencap -p > "$ARTIFACT_DIR/01-home.png"

# The home screen deliberately has no suggested prompts. Exercise the normal
# keyboard path so this check matches how a user submits their own question.
node "$PROJECT_DIR/scripts/android-tap.mjs" "Type a question"
node "$PROJECT_DIR/scripts/android-tap.mjs" "Type your question"
sleep 1
"$ADB" shell input text 'Nvidia%sstock%sprice'
sleep 1
node "$PROJECT_DIR/scripts/android-tap.mjs" "Send question"

QUERY_PASSED=false
for attempt in {1..45}; do
  if rg -q "AUDI_DEMO_ANSWER_COMPLETE" "$ARTIFACT_DIR/app-events.log"; then
    QUERY_PASSED=true
    break
  fi
  if rg -q "AUDI_DEMO_ANSWER_FAILED|FATAL EXCEPTION" "$ARTIFACT_DIR/app-events.log"; then
    break
  fi
  sleep 1
done

if [ "$QUERY_PASSED" = true ]; then
  # Check asynchronous visual and speech completion too, not just HTTP success.
  for attempt in {1..40}; do
    if rg -q "AUDI_CARD_READY" "$ARTIFACT_DIR/app-events.log" && rg -q "AUDI_SPEECH_FINISHED" "$ARTIFACT_DIR/app-events.log"; then
      break
    fi
    sleep 1
  done
fi

"$ADB" exec-out screencap -p > "$ARTIFACT_DIR/02-query-result.png"
"$ADB" logcat -d -t 2000 > "$ARTIFACT_DIR/logcat.txt"

if [ "$QUERY_PASSED" = true ]; then
  pass "End-to-end app query returned an answer"
else
  fail "End-to-end app query did not complete"
fi

for marker in AUDI_MAP_READY AUDI_CARD_READY AUDI_SPEECH_FINISHED; do
  if rg -q "$marker" "$ARTIFACT_DIR/app-events.log"; then
    pass "$marker"
  else
    fail "$marker was not observed"
  fi
done

if rg -q "FATAL EXCEPTION|Process: com.tako.volkswagen.demo.*has died" "$ARTIFACT_DIR/logcat.txt"; then
  fail "Android crash detected"
else
  pass "No Android crash detected"
fi

if rg -q "UnknownHostException|Unable to resolve host" "$ARTIFACT_DIR/logcat.txt"; then
  fail "DNS failure appeared during the query"
else
  pass "No DNS failure during the query"
fi

print "" | tee -a "$REPORT"
print "$PASS_COUNT passed, $FAIL_COUNT failed" | tee -a "$REPORT"
print "Evidence: $ARTIFACT_DIR" | tee -a "$REPORT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
