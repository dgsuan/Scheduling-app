import { useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import { colors, radius, spacing } from "@/constants/theme";
import {
  useCanvas,
  type CanvasItem,
  type Stroke,
  type TodoEntry,
} from "@/context/store";

// Freeform "open canvas" (Miro / Apple-Freeform style). A large pannable
// dotted surface holding draggable items: text notes, to-do lists,
// imported images, freehand drawings, and imported documents. Everything
// persists on-device via the shared store (context/store.tsx).

const DOT_SPACING = 28;
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 2600;
const COLS = Math.ceil(CANVAS_WIDTH / DOT_SPACING);
const ROWS = Math.ceil(CANVAS_HEIGHT / DOT_SPACING);

const CARD_W = 200;
const IMG_MAX_W = 220;
const IMG_MAX_H = 260;
const INK_COLORS = ["#1A1A1A", "#4F8CFF", "#E5484D", "#30A46C", "#F2A20C"];

function uid(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function strokePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M${p.x} ${p.y} L${p.x + 0.1} ${p.y + 0.1}`;
  }
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

// --- Dot grid ----------------------------------------------------------

function DotGrid() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const dots = [];
    for (let c = 0; c < COLS; c++) dots.push(<View key={c} style={styles.dot} />);
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

// --- Draggable wrapper -----------------------------------------------

function Draggable({
  item,
  onMoveEnd,
  children,
}: {
  item: CanvasItem;
  onMoveEnd: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const pan = useRef(new Animated.ValueXY({ x: item.x, y: item.y })).current;
  const pos = useRef({ x: item.x, y: item.y });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderGrant: () => {
        pan.setOffset({ ...pos.current });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();
        pos.current = {
          x: Math.max(0, pos.current.x + g.dx),
          y: Math.max(0, pos.current.y + g.dy),
        };
        onMoveEnd(pos.current.x, pos.current.y);
      },
    })
  ).current;

  return (
    <Animated.View
      style={[styles.itemWrap, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

function ItemBar({
  color,
  onCycleColor,
  onDelete,
}: {
  color?: string;
  onCycleColor?: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.itemBar}>
      {onCycleColor ? (
        <Pressable onPress={onCycleColor} hitSlop={6} style={styles.barBtn}>
          <Text style={styles.barIcon}>🎨</Text>
        </Pressable>
      ) : (
        <View style={styles.barBtn} />
      )}
      <View style={[styles.barGrip, color ? { backgroundColor: "rgba(0,0,0,0.12)" } : null]} />
      <Pressable onPress={onDelete} hitSlop={6} style={styles.barBtn}>
        <Text style={styles.barIcon}>✕</Text>
      </Pressable>
    </View>
  );
}

// --- Item bodies ------------------------------------------------------

function TextCard({
  item,
  update,
  remove,
}: {
  item: Extract<CanvasItem, { kind: "text" }>;
  update: (patch: Partial<CanvasItem>) => void;
  remove: () => void;
}) {
  const cycle = () => {
    const i = colors.noteColors.indexOf(item.color);
    update({ color: colors.noteColors[(i + 1) % colors.noteColors.length] });
  };
  return (
    <View style={[styles.card, { backgroundColor: item.color, width: 168 }]}>
      <ItemBar color={item.color} onCycleColor={cycle} onDelete={remove} />
      <TextInput
        style={styles.textInput}
        value={item.text}
        onChangeText={(text) => update({ text })}
        placeholder="Type…"
        placeholderTextColor="rgba(0,0,0,0.35)"
        multiline
      />
    </View>
  );
}

function TodoCard({
  item,
  update,
  remove,
}: {
  item: Extract<CanvasItem, { kind: "todo" }>;
  update: (patch: Partial<CanvasItem>) => void;
  remove: () => void;
}) {
  const setEntries = (entries: TodoEntry[]) => update({ entries });
  const cycle = () => {
    const i = colors.noteColors.indexOf(item.color);
    update({ color: colors.noteColors[(i + 1) % colors.noteColors.length] });
  };
  return (
    <View style={[styles.card, { backgroundColor: item.color, width: CARD_W }]}>
      <ItemBar color={item.color} onCycleColor={cycle} onDelete={remove} />
      <TextInput
        style={styles.todoTitle}
        value={item.title}
        onChangeText={(title) => update({ title })}
        placeholder="To-do list"
        placeholderTextColor="rgba(0,0,0,0.35)"
      />
      {item.entries.map((entry) => (
        <View key={entry.id} style={styles.todoRow}>
          <Pressable
            hitSlop={6}
            onPress={() =>
              setEntries(
                item.entries.map((e) =>
                  e.id === entry.id ? { ...e, done: !e.done } : e
                )
              )
            }
            style={[styles.checkbox, entry.done && styles.checkboxOn]}
          >
            {entry.done ? <Text style={styles.checkboxTick}>✓</Text> : null}
          </Pressable>
          <TextInput
            style={[styles.todoText, entry.done && styles.todoTextDone]}
            value={entry.text}
            onChangeText={(text) =>
              setEntries(
                item.entries.map((e) => (e.id === entry.id ? { ...e, text } : e))
              )
            }
            placeholder="Item"
            placeholderTextColor="rgba(0,0,0,0.3)"
          />
          <Pressable
            hitSlop={6}
            onPress={() => setEntries(item.entries.filter((e) => e.id !== entry.id))}
          >
            <Text style={styles.todoRemove}>–</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() =>
          setEntries([...item.entries, { id: uid("t"), text: "", done: false }])
        }
        style={styles.todoAdd}
      >
        <Text style={styles.todoAddText}>+ Add item</Text>
      </Pressable>
    </View>
  );
}

function ImageCard({
  item,
  remove,
}: {
  item: Extract<CanvasItem, { kind: "image" }>;
  remove: () => void;
}) {
  const ratio = item.width && item.height ? item.height / item.width : 0.75;
  let w = IMG_MAX_W;
  let h = w * ratio;
  if (h > IMG_MAX_H) {
    h = IMG_MAX_H;
    w = h / ratio;
  }
  return (
    <View style={[styles.card, styles.mediaCard, { width: w + 4 }]}>
      <ItemBar onDelete={remove} />
      <Image source={{ uri: item.uri }} style={{ width: w, height: h, borderRadius: 4 }} />
    </View>
  );
}

function DrawingCard({
  item,
  remove,
  onEdit,
}: {
  item: Extract<CanvasItem, { kind: "drawing" }>;
  remove: () => void;
  onEdit: () => void;
}) {
  const w = CARD_W;
  const h = (w * item.height) / item.width;
  return (
    <View style={[styles.card, styles.mediaCard, { width: w + 4 }]}>
      <ItemBar onDelete={remove} />
      <Pressable onPress={onEdit}>
        <View style={{ width: w, height: h, backgroundColor: "#FFFFFF", borderRadius: 4 }}>
          <Svg width={w} height={h} viewBox={`0 0 ${item.width} ${item.height}`}>
            {item.strokes.map((s, i) => (
              <Path
                key={i}
                d={strokePath(s.points)}
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
          <View style={styles.drawEditHint}>
            <Text style={styles.drawEditHintText}>tap to edit</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function DocumentCard({
  item,
  remove,
}: {
  item: Extract<CanvasItem, { kind: "document" }>;
  remove: () => void;
}) {
  const kb = item.size ? Math.max(1, Math.round(item.size / 1024)) : null;
  return (
    <View style={[styles.card, { width: CARD_W, backgroundColor: "#FFFFFF" }]}>
      <ItemBar onDelete={remove} />
      <Pressable
        style={styles.docBody}
        onPress={() =>
          Linking.openURL(item.uri).catch(() =>
            Alert.alert("Can't open", "No app available to open this file.")
          )
        }
      >
        <Text style={styles.docIcon}>📄</Text>
        <Text style={styles.docName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.docMeta}>
          {(item.mimeType ?? "file")}
          {kb ? ` · ${kb} KB` : ""}
        </Text>
      </Pressable>
    </View>
  );
}

// --- Drawing modal ---------------------------------------------------

function DrawSurface({
  initial,
  surfaceW,
  surfaceH,
  onCancel,
  onSave,
}: {
  initial: Stroke[];
  surfaceW: number;
  surfaceH: number;
  onCancel: () => void;
  onSave: (strokes: Stroke[]) => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [penWidth, setPenWidth] = useState(4);
  const inkRef = useRef(ink);
  const widthRef = useRef(penWidth);
  inkRef.current = ink;
  widthRef.current = penWidth;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        setCurrent({
          color: inkRef.current,
          width: widthRef.current,
          points: [{ x: locationX, y: locationY }],
        });
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        setCurrent((c) =>
          c ? { ...c, points: [...c.points, { x: locationX, y: locationY }] } : c
        );
      },
      onPanResponderRelease: () => {
        setCurrent((c) => {
          if (c && c.points.length) setStrokes((s) => [...s, c]);
          return null;
        });
      },
    })
  ).current;

  const all = current ? [...strokes, current] : strokes;

  return (
    <View style={styles.modalRoot}>
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Draw</Text>
          <Pressable onPress={() => onSave(strokes)} hitSlop={8}>
            <Text style={styles.modalDone}>Done</Text>
          </Pressable>
        </View>

        <View
          style={[styles.drawSurface, { width: surfaceW, height: surfaceH }]}
          {...responder.panHandlers}
        >
          <Svg width={surfaceW} height={surfaceH}>
            {all.map((s, i) => (
              <Path
                key={i}
                d={strokePath(s.points)}
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
        </View>

        <View style={styles.drawTools}>
          <View style={styles.inkRow}>
            {INK_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setInk(c)}
                style={[
                  styles.inkSwatch,
                  { backgroundColor: c },
                  ink === c && styles.inkSwatchOn,
                ]}
              />
            ))}
          </View>
          <View style={styles.inkRow}>
            {[2, 4, 8, 14].map((w) => (
              <Pressable
                key={w}
                onPress={() => setPenWidth(w)}
                style={[styles.penBtn, penWidth === w && styles.penBtnOn]}
              >
                <View style={{ width: w, height: w, borderRadius: w / 2, backgroundColor: "#1A1A1A" }} />
              </Pressable>
            ))}
          </View>
          <View style={styles.inkRow}>
            <Pressable
              style={styles.drawActionBtn}
              onPress={() => setStrokes((s) => s.slice(0, -1))}
            >
              <Text style={styles.drawActionText}>Undo</Text>
            </Pressable>
            <Pressable style={styles.drawActionBtn} onPress={() => setStrokes([])}>
              <Text style={styles.drawActionText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// --- Screen ---------------------------------------------------------

export default function NotesScreen() {
  const { items, addItem, updateItem, removeItem } = useCanvas();
  const { width: winW, height: winH } = useWindowDimensions();

  const scroll = useRef({ x: 0, y: 0 });
  const viewport = useRef({ w: 0, h: 0 });

  const [drawFor, setDrawFor] = useState<string | "new" | null>(null);

  const surfaceW = Math.min(winW - 2 * spacing.lg, 340);
  const surfaceH = Math.min(winH * 0.5, 440);

  const centerXY = () => ({
    x: Math.min(
      Math.max(0, scroll.current.x + viewport.current.w / 2 - CARD_W / 2),
      CANVAS_WIDTH - CARD_W
    ),
    y: Math.min(
      Math.max(0, scroll.current.y + viewport.current.h / 2 - 60),
      CANVAS_HEIGHT - 120
    ),
  });

  const addText = () => addItem({ kind: "text", text: "", color: colors.noteColors[0], ...centerXY() });
  const addTodo = () =>
    addItem({
      kind: "todo",
      title: "",
      color: colors.noteColors[1],
      entries: [{ id: uid("t"), text: "", done: false }],
      ...centerXY(),
    });

  const addImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to import an image.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (res.canceled) return;
    const a = res.assets[0];
    addItem({
      kind: "image",
      uri: a.uri,
      width: a.width ?? 1,
      height: a.height ?? 1,
      ...centerXY(),
    });
  };

  const addDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled) return;
    const a = res.assets[0];
    addItem({
      kind: "document",
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size ?? undefined,
      ...centerXY(),
    });
  };

  const saveDrawing = (strokes: Stroke[]) => {
    if (drawFor && drawFor !== "new") {
      updateItem(drawFor, { strokes });
    } else if (strokes.length) {
      addItem({
        kind: "drawing",
        strokes,
        color: INK_COLORS[0],
        width: surfaceW,
        height: surfaceH,
        ...centerXY(),
      });
    }
    setDrawFor(null);
  };

  const onHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.x = e.nativeEvent.contentOffset.x;
  };
  const onVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.y = e.nativeEvent.contentOffset.y;
  };

  const editingItem =
    drawFor && drawFor !== "new"
      ? (items.find((i) => i.id === drawFor && i.kind === "drawing") as
          | Extract<CanvasItem, { kind: "drawing" }>
          | undefined)
      : undefined;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.subtitle}>An open canvas — put anything, anywhere.</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbar}
        contentContainerStyle={styles.toolbarContent}
      >
        <ToolButton emoji="📝" label="Text" onPress={addText} />
        <ToolButton emoji="✅" label="To-do" onPress={addTodo} />
        <ToolButton emoji="🖼️" label="Image" onPress={addImage} />
        <ToolButton emoji="✏️" label="Draw" onPress={() => setDrawFor("new")} />
        <ToolButton emoji="📎" label="Doc" onPress={addDocument} />
      </ScrollView>

      <ScrollView
        style={styles.canvasScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onHScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewport.current.w = e.nativeEvent.layout.width;
          viewport.current.h = e.nativeEvent.layout.height;
        }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={onVScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.canvas}>
            <DotGrid />
            {items.map((item) => (
              <Draggable
                key={item.id}
                item={item}
                onMoveEnd={(x, y) => updateItem(item.id, { x, y })}
              >
                {item.kind === "text" ? (
                  <TextCard
                    item={item}
                    update={(p) => updateItem(item.id, p)}
                    remove={() => removeItem(item.id)}
                  />
                ) : item.kind === "todo" ? (
                  <TodoCard
                    item={item}
                    update={(p) => updateItem(item.id, p)}
                    remove={() => removeItem(item.id)}
                  />
                ) : item.kind === "image" ? (
                  <ImageCard item={item} remove={() => removeItem(item.id)} />
                ) : item.kind === "drawing" ? (
                  <DrawingCard
                    item={item}
                    remove={() => removeItem(item.id)}
                    onEdit={() => setDrawFor(item.id)}
                  />
                ) : (
                  <DocumentCard item={item} remove={() => removeItem(item.id)} />
                )}
              </Draggable>
            ))}
            {items.length === 0 ? (
              <View style={styles.hintNote} pointerEvents="none">
                <Text style={styles.hintNoteText}>
                  Use the toolbar above to add a note, to-do list, image,
                  drawing, or document — then drag it anywhere.
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </ScrollView>

      {drawFor !== null ? (
        <View style={StyleSheet.absoluteFill}>
          <DrawSurface
            initial={editingItem?.strokes ?? []}
            surfaceW={editingItem?.width ?? surfaceW}
            surfaceH={editingItem?.height ?? surfaceH}
            onCancel={() => setDrawFor(null)}
            onSave={saveDrawing}
          />
        </View>
      ) : null}
    </View>
  );
}

function ToolButton({
  emoji,
  label,
  onPress,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.toolBtn} onPress={onPress}>
      <Text style={styles.toolEmoji}>{emoji}</Text>
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightBg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: "700", color: colors.lightText },
  subtitle: { fontSize: 13, color: colors.lightMuted, marginTop: spacing.xs },

  toolbar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.lightBorder },
  toolbarContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  toolBtn: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    minWidth: 58,
  },
  toolEmoji: { fontSize: 18 },
  toolLabel: { fontSize: 11, color: colors.lightText, marginTop: 2, fontWeight: "600" },

  canvasScroll: { flex: 1 },
  canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, backgroundColor: colors.lightSurface },
  dotLayer: { ...StyleSheet.absoluteFillObject },
  dotRow: { flexDirection: "row", height: DOT_SPACING },
  dot: { width: DOT_SPACING, height: DOT_SPACING, paddingTop: 2, paddingLeft: 2 },

  itemWrap: { position: "absolute", top: 0, left: 0 },
  card: {
    borderRadius: radius.sm,
    paddingBottom: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  mediaCard: { backgroundColor: "#FFFFFF", padding: 2 },
  itemBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: 2,
  },
  barBtn: { padding: 2, minWidth: 18, alignItems: "center" },
  barIcon: { fontSize: 12 },
  barGrip: { flex: 1, height: 4, marginHorizontal: spacing.xs, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.08)" },

  textInput: {
    fontSize: 13,
    color: "#3A3A2A",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    minHeight: 48,
  },

  todoTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#3A3A2A",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  todoRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, gap: spacing.xs, paddingVertical: 2 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: "rgba(0,0,0,0.55)", borderColor: "rgba(0,0,0,0.55)" },
  checkboxTick: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  todoText: { flex: 1, fontSize: 13, color: "#3A3A2A", paddingVertical: 2 },
  todoTextDone: { textDecorationLine: "line-through", color: "rgba(0,0,0,0.4)" },
  todoRemove: { fontSize: 18, color: "rgba(0,0,0,0.4)", paddingHorizontal: 4 },
  todoAdd: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  todoAddText: { fontSize: 12, fontWeight: "700", color: "rgba(0,0,0,0.5)" },

  drawEditHint: {
    position: "absolute",
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  drawEditHintText: { color: "#FFFFFF", fontSize: 9 },

  docBody: { padding: spacing.md, alignItems: "center" },
  docIcon: { fontSize: 26 },
  docName: { fontSize: 13, fontWeight: "600", color: colors.lightText, textAlign: "center", marginTop: spacing.xs },
  docMeta: { fontSize: 11, color: colors.lightMuted, marginTop: 2, textAlign: "center" },

  hintNote: {
    position: "absolute",
    top: 60,
    left: 40,
    width: 220,
    backgroundColor: "#FFF7C2",
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  hintNoteText: { fontSize: 13, color: "#4A4A2A", lineHeight: 18 },

  // Draw modal
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  modalCard: { backgroundColor: colors.lightBg, borderRadius: radius.lg, padding: spacing.md, alignItems: "center" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.lightText },
  modalCancel: { fontSize: 14, color: colors.lightMuted },
  modalDone: { fontSize: 14, fontWeight: "700", color: colors.accent },
  drawSurface: { backgroundColor: "#FFFFFF", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lightBorder, overflow: "hidden" },
  drawTools: { marginTop: spacing.md, gap: spacing.sm, alignItems: "center" },
  inkRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  inkSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  inkSwatchOn: { borderColor: colors.lightText },
  penBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  penBtnOn: { borderColor: colors.accent, backgroundColor: "#E9F1FF" },
  drawActionBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  drawActionText: { fontSize: 13, fontWeight: "700", color: colors.lightText },
});
