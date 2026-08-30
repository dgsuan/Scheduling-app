import { useMemo } from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { radius, spacing, type Palette } from "@/constants/theme";
import { useTheme } from "@/context/theme";

// A greyed-out placeholder for actions that aren't wired up yet. Looks
// disabled and carries a "Coming soon" caption so it's obvious why
// nothing happens.
export function ComingSoonButton({
  label,
  style,
}: {
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  return (
    <Pressable
      disabled
      accessibilityState={{ disabled: true }}
      style={[styles.btn, style]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.soon}>Coming soon</Text>
    </Pressable>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    btn: {
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      opacity: 0.6,
    },
    label: { color: t.muted, fontWeight: "700", fontSize: 14 },
    soon: {
      color: t.muted,
      fontSize: 10,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: 1,
    },
  });
