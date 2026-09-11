import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Small "live" indicator: a solid dot with a soft ring that breathes out.

export function LiveDot({ color, size = 8 }: { color: string; size?: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }),
      -1,
      false
    );
  }, [t]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - t.value),
    transform: [{ scale: 1 + t.value * 1.6 }],
  }));

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no">
      <Animated.View
        style={[
          { position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          ring,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
