import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import { ComingSoonButton } from "@/components/ComingSoonButton";

// Import-from-LMS screen (e.g. UVLE). Mirrors the export panel on the
// Calendar tab, but in reverse. No network request or parsing is
// implemented yet — see ARCHITECTURE.md roadmap item "LMS import".
const IMPORT_SCOPES = [
  "All events",
  "Events related to courses",
  "Events related to groups",
] as const;

function RadioRow({
  label,
  selected,
  onSelect,
  styles,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable style={styles.radioRow} onPress={onSelect}>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

export default function ImportScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [scope, setScope] = useState<string>(IMPORT_SCOPES[0]);
  const [sourceUrl, setSourceUrl] = useState("");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Import from LMS</Text>
        <ThemeToggle />
      </View>
      <Text style={styles.sectionHint}>
        Paste a calendar/subscription URL from your LMS (e.g. UVLE&apos;s
        &quot;Export calendar&quot; link) to bring those events into this app.
        (UI only — nothing is fetched or saved yet.)
      </Text>

      <Text style={styles.fieldLabel}>LMS calendar URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://uvle.upd.edu.ph/calendar/export_execute.php?..."
        placeholderTextColor={t.muted}
        value={sourceUrl}
        onChangeText={setSourceUrl}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.fieldLabel}>What to import</Text>
      <View style={styles.optionGroup}>
        {IMPORT_SCOPES.map((option) => (
          <RadioRow
            key={option}
            label={option}
            selected={scope === option}
            onSelect={() => setScope(option)}
            styles={styles}
          />
        ))}
      </View>

      <ComingSoonButton label="Import" style={styles.importBtn} />

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>Not connected to an LMS yet.</Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xs,
    },
    title: { fontSize: 24, fontWeight: "700", color: t.text },
    sectionHint: {
      fontSize: 13,
      color: t.muted,
      marginBottom: spacing.lg,
      lineHeight: 18,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: t.text,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 14,
      color: t.text,
      backgroundColor: t.surface,
    },
    optionGroup: { gap: spacing.xs },
    radioRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.xs,
      gap: spacing.sm,
    },
    radioOuter: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: t.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOuterSelected: { borderColor: colors.accent },
    radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
    radioLabel: { fontSize: 14, color: t.text },
    importBtn: { marginTop: spacing.lg },
    statusBox: {
      marginTop: spacing.lg,
      backgroundColor: t.surface,
      borderRadius: radius.sm,
      padding: spacing.md,
    },
    statusText: { fontSize: 13, color: t.muted, textAlign: "center" },
  });
