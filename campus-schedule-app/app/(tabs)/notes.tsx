import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";

// Blank-canvas note screen (Miro-style freeform, not a fixed template).
// This scaffold only shows a pannable, dotted canvas surface — no
// sticky-note creation, dragging, or persistence yet. See
// ARCHITECTURE.md roadmap item "Canvas notes" for what comes next.
const GRID_COLUMNS = 14;
const GRID_ROWS = 24;
const DOT_SPACING = 28;

function DotGrid() {
  const dots = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      dots.push(
        <View
          key={`${row}-${col}`}
          style={[
            styles.dot,
            { left: col * DOT_SPACING, top: row * DOT_SPACING },
          ]}
        />
      );
    }
  }
  return <View style={styles.dotLayer}>{dots}</View>;
}

export default function NotesScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.subtitle}>An open canvas — put anything, anywhere.</Text>
      </View>

      <ScrollView
        style={styles.canvasScroll}
        contentContainerStyle={styles.canvasContent}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <ScrollView contentContainerStyle={styles.canvasContentInner} showsVerticalScrollIndicator={false}>
          <View style={styles.canvas}>
            <DotGrid />
            <View style={styles.placeholderNote}>
              <Text style={styles.placeholderNoteText}>Tap + to add a note</Text>
            </View>
          </View>
        </ScrollView>
      </ScrollView>

      <Pressable style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.lightBg,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.lightText,
  },
  subtitle: {
    fontSize: 13,
    color: colors.lightMuted,
    marginTop: spacing.xs,
  },
  canvasScroll: {
    flex: 1,
  },
  canvasContent: {
    flexGrow: 1,
  },
  canvasContentInner: {
    flexGrow: 1,
  },
  canvas: {
    width: GRID_COLUMNS * DOT_SPACING,
    height: GRID_ROWS * DOT_SPACING,
    backgroundColor: colors.lightSurface,
  },
  dotLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dot: {
    position: "absolute",
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.lightBorder,
  },
  placeholderNote: {
    position: "absolute",
    top: 60,
    left: 60,
    backgroundColor: "#FFF7C2",
    borderRadius: radius.sm,
    padding: spacing.md,
    width: 160,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  placeholderNoteText: {
    fontSize: 13,
    color: "#4A4A2A",
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 30,
  },
});
