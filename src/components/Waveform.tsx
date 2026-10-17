import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

const BAR_HEIGHTS = [16, 30, 46, 28, 54, 36, 22];

export function Waveform({ active, level = -2 }: { active: boolean; level?: number }) {
  const animations = useRef(BAR_HEIGHTS.map(() => new Animated.Value(0.35))).current;

  useEffect(() => {
    if (!active) {
      animations.forEach((value) => value.setValue(0.35));
      return;
    }

    const loops = animations.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 55),
          Animated.timing(value, {
            toValue: 1,
            duration: 360 + index * 30,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.25,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [active, animations]);

  return (
    <View style={styles.row} accessibilityLabel={active ? "Listening" : "Voice idle"}>
      {BAR_HEIGHTS.map((height, index) => (
        <Animated.View
          key={`bar-${index}`}
          style={[
            styles.bar,
            {
              height,
              transform: [{
                scaleY: active && level > -1
                  ? Math.min(1, 0.3 + ((level + 1) / 11) * 1.4)
                  : animations[index] ?? 1,
              }],
              opacity: active ? 1 : 0.45,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 62, flexDirection: "row", alignItems: "center", gap: 6 },
  bar: { width: 3, borderRadius: 2, backgroundColor: "#E5DCEB" },
});
