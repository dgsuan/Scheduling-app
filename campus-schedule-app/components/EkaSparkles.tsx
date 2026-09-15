import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";

// Background decoration for Eka mode: behind everything, never touchable,
// hidden from screen readers.

const BITS: { glyph: string; top: `${number}%`; left?: `${number}%`; right?: `${number}%`; size: number; rotate: number }[] = [
  { glyph: "♡", top: "12%", right: "3%", size: 26, rotate: 12 },
  { glyph: "✿", top: "14%", right: "22%", size: 18, rotate: -8 },
  { glyph: "✦", top: "9%", left: "38%", size: 14, rotate: 0 },
  { glyph: "♡", top: "46%", right: "2%", size: 18, rotate: -14 },
  { glyph: "✧", top: "62%", left: "1.5%", size: 20, rotate: 10 },
  { glyph: "✿", top: "84%", right: "8%", size: 24, rotate: 18 },
  { glyph: "♡", top: "92%", left: "30%", size: 16, rotate: -6 },
  { glyph: "✦", top: "36%", right: "12%", size: 12, rotate: 0 },
];

export function EkaSparkles({ color }: { color: string }) {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="eka-sparkles"
    >
      {BITS.map((b, i) => (
        <Text
          key={i}
          selectable={false}
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            right: b.right,
            fontSize: b.size,
            lineHeight: b.size * 1.2,
            color,
            opacity: 0.28,
            transform: [{ rotate: `${b.rotate}deg` }],
          }}
        >
          {b.glyph}
        </Text>
      ))}
    </View>
  );
}
