import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";

// Small spring entrance for things that appear in response to the user
// (popovers, newly added items). Settles in ~250ms; respects Reduce Motion.

export function PopIn({
  children,
  style,
  delay = 0,
  from = 0.96,
  offsetY = 4,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  from?: number;
  offsetY?: number;
}) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withDelay(
      delay,
      withSpring(1, { damping: 18, stiffness: 280, mass: 0.7, reduceMotion: ReduceMotion.System })
    );
  }, [delay, p]);

  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: (1 - p.value) * offsetY },
      { scale: from + (1 - from) * p.value },
    ],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
