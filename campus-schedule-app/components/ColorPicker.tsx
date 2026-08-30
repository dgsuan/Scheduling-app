import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { useTheme } from "@/context/theme";
import {
  HUES,
  hslToHex,
  hueSwatch,
  isLight,
  LIGHTNESS_RAMP,
  normalizeHex,
} from "@/lib/color";

const HUE_SAT = 68;

// Reusable colour picker: a live preview + hex entry, a preset row, a hue
// wheel row, and a lightness ramp for the chosen hue. Used by the course
// label field and the drawing-ink picker.
export function ColorPicker({
  value,
  onChange,
  label = "Color",
  presets = colors.courseColors,
}: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  presets?: string[];
}) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [hue, setHue] = useState<number>(HUES[0]);
  const [hexText, setHexText] = useState<string>(value);

  // Keep the hex field in sync when the colour is changed from outside.
  useEffect(() => {
    setHexText(value);
  }, [value]);

  const pick = (hex: string) => {
    setHexText(hex);
    onChange(hex);
  };

  const commitHex = (raw: string) => {
    setHexText(raw);
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  const norm = normalizeHex(value);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.previewRow}>
        <View style={[styles.preview, { backgroundColor: value }]}>
          <Text
            style={[
              styles.previewText,
              { color: isLight(value) ? "#1A1A1A" : "#FFFFFF" },
            ]}
          >
            {value}
          </Text>
        </View>
        <TextInput
          style={styles.hexInput}
          value={hexText}
          onChangeText={commitHex}
          onBlur={() => setHexText(value)}
          placeholder="#4F8CFF"
          placeholderTextColor={t.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
        />
      </View>

      <Text style={styles.small}>Presets</Text>
      <View style={styles.row}>
        {presets.map((c) => (
          <Pressable
            key={c}
            onPress={() => pick(c)}
            style={[styles.swatch, { backgroundColor: c }, norm === normalizeHex(c) && styles.selected]}
          />
        ))}
      </View>

      <Text style={styles.small}>Hue</Text>
      <View style={styles.row}>
        {HUES.map((h) => (
          <Pressable
            key={h}
            onPress={() => {
              setHue(h);
              pick(hslToHex(h, HUE_SAT, 52));
            }}
            style={[styles.swatch, { backgroundColor: hueSwatch(h) }, hue === h && styles.selected]}
          />
        ))}
      </View>

      <Text style={styles.small}>Shade</Text>
      <View style={styles.row}>
        {LIGHTNESS_RAMP.map((l) => {
          const hex = hslToHex(hue, HUE_SAT, l);
          return (
            <Pressable
              key={l}
              onPress={() => pick(hex)}
              style={[styles.swatch, { backgroundColor: hex }, norm === hex && styles.selected]}
            />
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    label: {
      fontSize: 13,
      fontWeight: "700",
      color: t.text,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    small: {
      fontSize: 12,
      color: t.muted,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    previewRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    preview: {
      width: 96,
      height: 40,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    previewText: { fontSize: 11, fontWeight: "700" },
    hexInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 14,
      color: t.text,
      backgroundColor: t.inputBg,
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xs },
    swatch: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.border,
    },
    selected: { borderColor: t.text },
  });
