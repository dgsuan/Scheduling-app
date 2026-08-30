import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";

// Import-from-LMS screen (e.g. UVLE). Mirrors the export panel on the
// Calendar tab, but in reverse: paste/enter a source, choose what to
// pull in, then bring it into this app's calendar. No network request
// or parsing is implemented yet — see ARCHITECTURE.md roadmap item
// "LMS import".
const IMPORT_SCOPES = [
  "All events",
  "Events related to courses",
  "Events related to groups",
] as const;

function RadioRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
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
  const [scope, setScope] = useState<string>(IMPORT_SCOPES[0]);
  const [sourceUrl, setSourceUrl] = useState("");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Import from LMS</Text>
      <Text style={styles.sectionHint}>
        Paste a calendar/subscription URL from your LMS (e.g. UVLE&apos;s
        &quot;Export calendar&quot; link) to bring those events into this
        app. (UI only — nothing is fetched or saved yet.)
      </Text>

      <Text style={styles.fieldLabel}>LMS calendar URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://uvle.upd.edu.ph/calendar/export_execute.php?..."
        placeholderTextColor={colors.lightMuted}
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
          />
        ))}
      </View>

      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Import</Text>
      </Pressable>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>Not connected to an LMS yet.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.lightBg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.lightText,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.lightMuted,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.lightText,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.lightText,
    backgroundColor: colors.lightSurface,
  },
  optionGroup: {
    gap: spacing.xs,
  },
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
    borderColor: colors.lightBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: colors.accent,
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  radioLabel: {
    fontSize: 14,
    color: colors.lightText,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  statusBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.lightSurface,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  statusText: {
    fontSize: 13,
    color: colors.lightMuted,
    textAlign: "center",
  },
});
