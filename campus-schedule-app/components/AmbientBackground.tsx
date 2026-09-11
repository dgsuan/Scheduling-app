import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// A single soft tint that fades down from the top of the window — the
// "sky" of the current time of day. Sits behind everything, never
// intercepts touches, and fades out well before content-heavy areas.

export function AmbientBackground({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="ambient-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="0.42" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ambient-wash)" />
      </Svg>
    </View>
  );
}
