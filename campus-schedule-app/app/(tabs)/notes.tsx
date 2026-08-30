import { useRef, useState } from "react";
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { useNotes, type Note } from "@/context/store";

// Freeform "open canvas" notes (Miro / Apple-Freeform style). The canvas
// is a large pannable, dotted surface. You can:
//   - drop a note anywhere (FAB drops one in the middle of what you're
//     looking at; "Tap to place" mode drops one wherever you tap)
//   - drag any note anywhere on the canvas
//   - type into any note, recolor it, or delete it
// Notes persist on-device via the shared store (context/store.tsx).

const DOT_SPACING = 28;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 2400;
const COLS = Math.ceil(CANVAS_WIDTH / DOT_SPACING);
const ROWS = Math.ceil(CANVAS_HEIGHT / DOT_SPACING);
const NOTE_WIDTH = 168;

function DotGrid() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const dots = [];
    for (let c = 0; c < COLS; c++) {
      dots.push(<View key={c} style={styles.dot} />);
    }
    rows.push(
      <View key={r} style={styles.dotRow}>
        {dots}
      </View>
    );
  }
  return (
    <View style={styles.dotLayer} pointerEvents="none">
      {rows}
    </View>
  );
}

function DraggableNote({
  note,
  onChangeText,
  onMoveEnd,
  onCycleColor,
  onDelete,
}: {
  note: Note;
  onChangeText: (text: string) => void;
  onMoveEnd: (x: number, y: number) => void;
  onCycleColor: () => void;
  onDelete: () => void;
}) {
  const pan = useRef(new Animated.ValueXY({ x: note.x, y: note.y })).current;
  const position = useRef({ x: note.x, y: note.y });

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture once it's clearly a drag — taps still reach
      // the text field and buttons, and the canvas can still be panned.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        pan.setOffset({ ...position.current });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();
        position.current = {
          x: Math.max(0, position.current.x + g.dx),
          y: Math.max(0, position.current.y + g.dy),
        };
        onMoveEnd(position.current.x, position.current.y);
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.note,
        { backgroundColor: note.color, transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.noteBar} {...panResponder.panHandlers}>
        <Pressable onPress={onCycleColor} hitSlop={6} style={styles.noteBarBtn}>
          <Text style={styles.noteBarIcon}>🎨</Text>
        </Pressable>
        <View style={styles.noteBarDrag} />
        <Pressable onPress={onDelete} hitSlop={6} style={styles.noteBarBtn}>
          <Text style={styles.noteBarIcon}>✕</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.noteText}
        value={note.text}
        onChangeText={onChangeText}
        placeholder="Type…"
        placeholderTextColor="rgba(0,0,0,0.35)"
        multiline
      />
    </Animated.View>
  );
}

export default function NotesScreen() {
  const { notes, addNote, updateNote, removeNote } = useNotes();
  const [placeMode, setPlaceMode] = useState(false);

  // Track scroll offset + viewport size so the FAB can drop a note in the
  // middle of whatever part of the canvas is currently visible.
  const scroll = useRef({ x: 0, y: 0 });
  const viewport = useRef({ w: 0, h: 0 });

  const nextColor = (current: string) => {
    const i = colors.noteColors.indexOf(current);
    return colors.noteColors[(i + 1) % colors.noteColors.length];
  };

  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(0, x), CANVAS_WIDTH - NOTE_WIDTH),
    y: Math.min(Math.max(0, y), CANVAS_HEIGHT - 80),
  });

  const dropInView = () => {
    const { x, y } = clamp(
      scroll.current.x + viewport.current.w / 2 - NOTE_WIDTH / 2,
      scroll.current.y + viewport.current.h / 2 - 40
    );
    addNote({ x, y, text: "", color: colors.noteColors[0] });
  };

  const dropAt = (px: number, py: number) => {
    const { x, y } = clamp(px - NOTE_WIDTH / 2, py - 20);
    addNote({ x, y, text: "", color: colors.noteColors[0] });
    setPlaceMode(false);
  };

  const onVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.y = e.nativeEvent.contentOffset.y;
  };
  const onHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.x = e.nativeEvent.contentOffset.x;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.subtitle}>An open canvas — put anything, anywhere.</Text>
        <Pressable
          onPress={() => setPlaceMode((v) => !v)}
          style={[styles.placeToggle, placeMode && styles.placeToggleOn]}
        >
          <Text style={[styles.placeToggleText, placeMode && styles.placeToggleTextOn]}>
            {placeMode ? "Tap the canvas to place…" : "＋ Tap to place a note"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.canvasScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!placeMode}
        onScroll={onHScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewport.current.w = e.nativeEvent.layout.width;
          viewport.current.h = e.nativeEvent.layout.height;
        }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={!placeMode}
          onScroll={onVScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.canvas}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={(e) => {
                if (placeMode) {
                  dropAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
                }
              }}
            />
            <DotGrid />
            {notes.map((note) => (
              <DraggableNote
                key={note.id}
                note={note}
                onChangeText={(text) => updateNote(note.id, { text })}
                onMoveEnd={(x, y) => updateNote(note.id, { x, y })}
                onCycleColor={() => updateNote(note.id, { color: nextColor(note.color) })}
                onDelete={() => removeNote(note.id)}
              />
            ))}
            {notes.length === 0 ? (
              <View style={styles.hintNote} pointerEvents="none">
                <Text style={styles.hintNoteText}>
                  Tap the + button, or “Tap to place”, to add your first note.
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </ScrollView>

      <Pressable style={styles.fab} onPress={dropInView} accessibilityLabel="Add note">
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
  placeToggle: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  placeToggleOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  placeToggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.lightText,
  },
  placeToggleTextOn: {
    color: "#FFFFFF",
  },
  canvasScroll: {
    flex: 1,
  },
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: colors.lightSurface,
  },
  dotLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  dotRow: {
    flexDirection: "row",
    height: DOT_SPACING,
  },
  dot: {
    width: DOT_SPACING,
    height: DOT_SPACING,
    paddingTop: 2,
    paddingLeft: 2,
  },
  note: {
    position: "absolute",
    top: 0,
    left: 0,
    width: NOTE_WIDTH,
    borderRadius: radius.sm,
    paddingBottom: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  noteBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  noteBarBtn: {
    padding: 2,
  },
  noteBarIcon: {
    fontSize: 12,
  },
  noteBarDrag: {
    flex: 1,
    height: 4,
    marginHorizontal: spacing.xs,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  noteText: {
    fontSize: 13,
    color: "#3A3A2A",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    minHeight: 44,
  },
  hintNote: {
    position: "absolute",
    top: 80,
    left: 40,
    width: 200,
    backgroundColor: "#FFF7C2",
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  hintNoteText: {
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
