import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
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
import {
  Gesture,
  GestureDetector,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import {
  GENERAL_CANVAS,
  useCanvas,
  useCourses,
  type CanvasItem,
  type Drawing,
  type Stroke,
  type TodoEntry,
} from "@/context/store";
import { strokePath, strokesToDrawing, type DrawingShape } from "@/lib/drawing";
import { ColorPicker } from "@/components/ColorPicker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatShortDate } from "@/lib/calendar";

// Freeform "open canvas" notes (Miro / Apple-Freeform style). One shared
// canvas plus a canvas per enrolled course, chosen from the tab strip.
// Each canvas holds draggable items (text, to-do, image, document) and
// freehand ink; a finished sketch becomes one movable, resizable object.

const DOT_SPACING = 28;
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 2600;

const CARD_W = 200;
const IMG_MAX_W = 220;
const IMG_MAX_H = 260;
const INK_COLORS = ["#1A1A1A", "#FFFFFF", "#4F8CFF", "#E5484D", "#30A46C", "#F2A20C"];
const INK_PRESETS = [
  "#1A1A1A",
  "#FFFFFF",
  "#4F8CFF",
  "#E5484D",
  "#30A46C",
  "#F2A20C",
  "#8E4EC6",
  "#E93D82",
];
const PEN_WIDTHS = [2, 4, 8, 14];
const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

function uid(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Dot grid: a single SVG pattern (not thousands of Views) ---------

function DotGrid({ color }: { color: string }) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      pointerEvents="none"
    >
      <Defs>
        <Pattern
          id="dg"
          x="0"
          y="0"
          width={DOT_SPACING}
          height={DOT_SPACING}
          patternUnits="userSpaceOnUse"
        >
          <Circle cx="2" cy="2" r="1.5" fill={color} />
        </Pattern>
      </Defs>
      <Rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#dg)" />
    </Svg>
  );
}

// --- Draggable card wrapper (gesture-handler → smooth, diagonal) ------

function Draggable({
  item,
  disabled,
  onMoveEnd,
  children,
}: {
  item: CanvasItem;
  disabled: boolean;
  onMoveEnd: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const tx = useRef(new Animated.Value(item.x)).current;
  const ty = useRef(new Animated.Value(item.y)).current;
  const startPos = useRef({ x: item.x, y: item.y });

  useEffect(() => {
    startPos.current = { x: item.x, y: item.y };
    tx.setValue(item.x);
    ty.setValue(item.y);
  }, [item.x, item.y, tx, ty]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Reanimated (needed by NativeWind) would otherwise run these
        // callbacks as UI-thread worklets, where setValue/props can't be called.
        .runOnJS(true)
        .enabled(!disabled)
        .activeOffsetX([-6, 6])
        .activeOffsetY([-6, 6])
        .onUpdate((e) => {
          tx.setValue(startPos.current.x + e.translationX);
          ty.setValue(startPos.current.y + e.translationY);
        })
        .onEnd((e) => {
          const nx = Math.max(0, startPos.current.x + e.translationX);
          const ny = Math.max(0, startPos.current.y + e.translationY);
          startPos.current = { x: nx, y: ny };
          tx.setValue(nx);
          ty.setValue(ny);
          onMoveEnd(nx, ny);
        }),
    [disabled, onMoveEnd, tx, ty]
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[cardStyles.itemWrap, { transform: [{ translateX: tx }, { translateY: ty }] }]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

function ItemBar({
  onCycleColor,
  onDelete,
}: {
  onCycleColor?: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={cardStyles.itemBar}>
      {onCycleColor ? (
        <Pressable onPress={onCycleColor} hitSlop={6} style={cardStyles.barBtn}>
          <Text style={cardStyles.barIcon}>🎨</Text>
        </Pressable>
      ) : (
        <View style={cardStyles.barBtn} />
      )}
      <View style={cardStyles.barGrip} />
      <Pressable onPress={onDelete} hitSlop={6} style={cardStyles.barBtn}>
        <Text style={cardStyles.barIcon}>✕</Text>
      </Pressable>
    </View>
  );
}

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
    <View style={[cardStyles.card, { backgroundColor: item.color, width: 168 }]}>
      <ItemBar onCycleColor={cycle} onDelete={remove} />
      <TextInput
        style={cardStyles.textInput}
        value={item.text}
        onChangeText={(text) => update({ text })}
        placeholder="Type…"
        placeholderTextColor="rgba(0,0,0,0.35)"
        multiline
      />
      {item.date ? (
        <Text style={cardStyles.noteDate}>
          📅 {formatShortDate(item.date)}
          {item.endDate ? ` – ${formatShortDate(item.endDate)}` : ""}
        </Text>
      ) : null}
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
    <View style={[cardStyles.card, { backgroundColor: item.color, width: CARD_W }]}>
      <ItemBar onCycleColor={cycle} onDelete={remove} />
      <TextInput
        style={cardStyles.todoTitle}
        value={item.title}
        onChangeText={(title) => update({ title })}
        placeholder="To-do list"
        placeholderTextColor="rgba(0,0,0,0.35)"
      />
      {item.entries.map((entry) => (
        <View key={entry.id} style={cardStyles.todoRow}>
          <Pressable
            hitSlop={6}
            onPress={() =>
              setEntries(
                item.entries.map((e) => (e.id === entry.id ? { ...e, done: !e.done } : e))
              )
            }
            style={[cardStyles.checkbox, entry.done && cardStyles.checkboxOn]}
          >
            {entry.done ? <Text style={cardStyles.checkboxTick}>✓</Text> : null}
          </Pressable>
          <TextInput
            style={[cardStyles.todoText, entry.done && cardStyles.todoTextDone]}
            value={entry.text}
            onChangeText={(text) =>
              setEntries(item.entries.map((e) => (e.id === entry.id ? { ...e, text } : e)))
            }
            placeholder="Item"
            placeholderTextColor="rgba(0,0,0,0.3)"
          />
          <Pressable
            hitSlop={6}
            onPress={() => setEntries(item.entries.filter((e) => e.id !== entry.id))}
          >
            <Text style={cardStyles.todoRemove}>–</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() =>
          setEntries([...item.entries, { id: uid("t"), text: "", done: false }])
        }
        style={cardStyles.todoAdd}
      >
        <Text style={cardStyles.todoAddText}>+ Add item</Text>
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
    <View style={[cardStyles.card, cardStyles.mediaCard, { width: w + 4 }]}>
      <ItemBar onDelete={remove} />
      <Image source={{ uri: item.uri }} style={{ width: w, height: h, borderRadius: 4 }} />
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
    <View style={[cardStyles.card, { width: CARD_W, backgroundColor: "#FFFFFF" }]}>
      <ItemBar onDelete={remove} />
      <Pressable
        style={cardStyles.docBody}
        onPress={() =>
          Linking.openURL(item.uri).catch(() =>
            Alert.alert("Can't open", "No app available to open this file.")
          )
        }
      >
        <Text style={cardStyles.docIcon}>📄</Text>
        <Text style={cardStyles.docName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={cardStyles.docMeta}>
          {item.mimeType ?? "file"}
          {kb ? ` · ${kb} KB` : ""}
        </Text>
      </Pressable>
    </View>
  );
}

// --- Folder: an item whose contents are a nested canvas -------------

const FOLDER_W = 132;
const FOLDER_H = 116;

function FolderCard({
  item,
  onOpen,
  onRename,
  onDelete,
}: {
  item: Extract<CanvasItem, { kind: "folder" }>;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { items } = useCanvas(item.id);
  const n = items.length;
  return (
    <View style={cardStyles.folderCard}>
      <View style={cardStyles.itemBar}>
        <View style={cardStyles.barBtn} />
        <View style={cardStyles.barGrip} />
        <Pressable
          onPress={onDelete}
          hitSlop={6}
          style={cardStyles.barBtn}
          accessibilityRole="button"
          accessibilityLabel={`Delete folder ${item.name || ""}`.trim()}
        >
          <Text style={cardStyles.barIcon}>✕</Text>
        </Pressable>
      </View>
      <Pressable onPress={onOpen} style={cardStyles.folderOpen}>
        <Text style={cardStyles.folderIcon}>📁</Text>
        <Text style={cardStyles.folderCount}>
          {n} item{n === 1 ? "" : "s"}
        </Text>
      </Pressable>
      <TextInput
        style={cardStyles.folderName}
        value={item.name}
        onChangeText={onRename}
        placeholder="Folder"
        placeholderTextColor="rgba(0,0,0,0.4)"
      />
    </View>
  );
}

// --- Finished drawing: movable + resizable ---------------------------

const HANDLE = 12; // resize handle size
const HANDLE_PAD = 10; // room around a drawing so its corner handles are hittable

type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

function DrawingObject({
  drawing,
  selected,
  interactive,
  onSelect,
  onChange,
}: {
  drawing: Drawing;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Pick<Drawing, "x" | "y" | "scale">>) => void;
}) {
  const w = Math.max(drawing.width, 1);
  const h = Math.max(drawing.height, 1);

  const tx = useRef(new Animated.Value(drawing.x)).current;
  const ty = useRef(new Animated.Value(drawing.y)).current;
  const startPos = useRef({ x: drawing.x, y: drawing.y });
  const livePos = useRef({ x: drawing.x, y: drawing.y });

  const [scale, setScale] = useState(drawing.scale ?? 1);
  const startScale = useRef(drawing.scale ?? 1);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const movedRef = useRef(false);
  const pinchedRef = useRef(false);

  useEffect(() => {
    startPos.current = { x: drawing.x, y: drawing.y };
    livePos.current = { x: drawing.x, y: drawing.y };
    tx.setValue(drawing.x);
    ty.setValue(drawing.y);
  }, [drawing.x, drawing.y, tx, ty]);
  useEffect(() => {
    const s = drawing.scale ?? 1;
    startScale.current = s;
    setScale(s);
  }, [drawing.scale]);

  // Corner handles (mouse/trackpad friendly). Each handle is its own
  // gesture outside the move area, so resizing never drags the drawing.
  // The drag is projected onto the corner's diagonal → aspect ratio kept.
  // The origin lives in a ref: re-renders mid-drag rebuild these gestures,
  // and a closure-local origin would reset (snapping the drawing to 0,0).
  const resizeOrigin = useRef({ x: 0, y: 0, s: 1 });
  const resize = useMemo(() => {
    const make = (corner: Corner) => {
      const fromLeft = corner === "tl" || corner === "bl";
      const fromTop = corner === "tl" || corner === "tr";
      return Gesture.Pan()
        .runOnJS(true)
        .enabled(interactive)
        .minDistance(0)
        .onBegin(() => {
          resizeOrigin.current = { ...startPos.current, s: startScale.current };
        })
        .onUpdate((e) => {
          const origin = resizeOrigin.current;
          const dx = (fromLeft ? -e.translationX : e.translationX) / w;
          const dy = (fromTop ? -e.translationY : e.translationY) / h;
          const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, origin.s + (dx + dy) / 2));
          const x = fromLeft ? origin.x + w * (origin.s - s) : origin.x;
          const y = fromTop ? origin.y + h * (origin.s - s) : origin.y;
          livePos.current = { x, y };
          scaleRef.current = s;
          tx.setValue(x);
          ty.setValue(y);
          setScale(s);
        })
        .onEnd(() => {
          const { x, y } = livePos.current;
          startPos.current = { x, y };
          startScale.current = scaleRef.current;
          onChange({ x, y, scale: scaleRef.current });
        });
    };
    return { tl: make("tl"), tr: make("tr"), bl: make("bl"), br: make("br") };
  }, [interactive, onChange, w, h, tx, ty]);

  // One finger anywhere on the drawing = move; a barely-moved tap = select.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(interactive)
        .minDistance(0)
        .onBegin(() => {
          movedRef.current = false;
          pinchedRef.current = false;
        })
        .onUpdate((e) => {
          if (pinchedRef.current) return; // let pinch own the gesture
          if (Math.abs(e.translationX) > 3 || Math.abs(e.translationY) > 3) {
            movedRef.current = true;
          }
          tx.setValue(startPos.current.x + e.translationX);
          ty.setValue(startPos.current.y + e.translationY);
        })
        .onEnd((e) => {
          if (pinchedRef.current) {
            tx.setValue(startPos.current.x);
            ty.setValue(startPos.current.y);
            return;
          }
          if (!movedRef.current) {
            onSelect();
            tx.setValue(startPos.current.x);
            ty.setValue(startPos.current.y);
            return;
          }
          const nx = Math.max(0, startPos.current.x + e.translationX);
          const ny = Math.max(0, startPos.current.y + e.translationY);
          startPos.current = { x: nx, y: ny };
          livePos.current = { x: nx, y: ny };
          tx.setValue(nx);
          ty.setValue(ny);
          onChange({ x: nx, y: ny });
        }),
    [interactive, onChange, onSelect, tx, ty]
  );

  // Two fingers = pinch to resize (touch screens).
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .enabled(interactive)
        .onUpdate((e) => {
          pinchedRef.current = true;
          const next = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, startScale.current * e.scale)
          );
          scaleRef.current = next;
          setScale(next);
        })
        .onEnd(() => {
          startScale.current = scaleRef.current;
          onChange({ scale: scaleRef.current });
        }),
    [interactive, onChange]
  );

  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);

  const dispW = w * scale;
  const dispH = h * scale;

  return (
    <Animated.View
      pointerEvents={interactive ? "box-none" : "none"}
      style={[
        cardStyles.drawingObj,
        {
          width: dispW + HANDLE_PAD * 2,
          height: dispH + HANDLE_PAD * 2,
          transform: [{ translateX: tx }, { translateY: ty }],
        },
      ]}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            { position: "absolute", left: HANDLE_PAD, top: HANDLE_PAD, width: dispW, height: dispH },
            selected && cardStyles.drawingObjSelected,
          ]}
        >
          <View className="web:cursor-move" style={StyleSheet.absoluteFill}>
            <Svg width={dispW} height={dispH} viewBox={`0 0 ${w} ${h}`} pointerEvents="none">
              {drawing.strokes.map((s, i) => (
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
        </Animated.View>
      </GestureDetector>

      {selected && interactive
        ? CORNERS.map((c) => (
            <GestureDetector key={c} gesture={resize[c]}>
              <View
                accessibilityLabel="Resize drawing"
                className={
                  c === "tl" || c === "br" ? "web:cursor-nwse-resize" : "web:cursor-nesw-resize"
                }
                style={[
                  cardStyles.handle,
                  {
                    left: HANDLE_PAD - HANDLE / 2 + (c === "tr" || c === "br" ? dispW : 0),
                    top: HANDLE_PAD - HANDLE / 2 + (c === "bl" || c === "br" ? dispH : 0),
                  },
                ]}
              />
            </GestureDetector>
          ))
        : null}
    </Animated.View>
  );
}

// --- Live drawing capture (isolated: only this re-renders per stroke) -

type DrawCaptureHandle = {
  undo: () => void;
  clear: () => void;
  commit: () => DrawingShape | null;
};

const DrawCapture = forwardRef<
  DrawCaptureHandle,
  { ink: string; penWidth: number }
>(({ ink, penWidth }, ref) => {
  const [pending, setPending] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const inkRef = useRef(ink);
  const widthRef = useRef(penWidth);
  inkRef.current = ink;
  widthRef.current = penWidth;
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => setPending((p) => p.slice(0, -1)),
      clear: () => {
        setPending([]);
        setCurrent(null);
      },
      commit: () => strokesToDrawing(current ? [...pending, current] : pending),
    }),
    [pending, current]
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        lastPt.current = { x: locationX, y: locationY };
        setCurrent({
          color: inkRef.current,
          width: widthRef.current,
          points: [{ x: locationX, y: locationY }],
        });
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const p = { x: locationX, y: locationY };
        if (lastPt.current && dist(lastPt.current, p) < 2) return; // thin out
        lastPt.current = p;
        setCurrent((c) => (c ? { ...c, points: [...c.points, p] } : c));
      },
      onPanResponderRelease: () => {
        lastPt.current = null;
        setCurrent((c) => {
          if (c && c.points.length) setPending((prev) => [...prev, c]);
          return null;
        });
      },
    })
  ).current;

  const all = current ? [...pending, current] : pending;

  return (
    <>
      <Svg
        style={StyleSheet.absoluteFill}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        pointerEvents="none"
      >
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
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />
    </>
  );
});
DrawCapture.displayName = "DrawCapture";

// --- Screen ---------------------------------------------------------

export default function NotesScreen() {
  const { courses } = useCourses();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const tabs = [
    { id: GENERAL_CANVAS, label: "General", color: colors.accent },
    ...courses
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ id: c.id, label: c.code, color: c.color })),
  ];

  const [active, setActive] = useState<string>(GENERAL_CANVAS);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (active !== GENERAL_CANVAS && !courses.some((c) => c.id === active)) {
      setActive(GENERAL_CANVAS);
    }
  }, [courses, active]);

  const rootLabel = tabs.find((tb) => tb.id === active)?.label ?? "General";
  const currentCanvasId = folderStack.length
    ? folderStack[folderStack.length - 1].id
    : active;

  const selectTab = (id: string) => {
    setActive(id);
    setFolderStack([]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Notes</Text>
          <ThemeToggle />
        </View>
        <Text style={styles.subtitle}>An open canvas — put anything, anywhere.</Text>
      </View>

      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => selectTab(tab.id)}
              style={[styles.tab, active === tab.id && styles.tabActive]}
            >
              <View style={[styles.tabDot, { backgroundColor: tab.color }]} />
              <Text style={[styles.tabText, active === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {folderStack.length > 0 ? (
        <View style={styles.breadcrumb}>
          <Pressable onPress={() => setFolderStack((s) => s.slice(0, -1))} hitSlop={8}>
            <Text style={styles.crumbBack}>‹ Back</Text>
          </Pressable>
          <Text style={styles.crumbPath} numberOfLines={1}>
            {rootLabel} / {folderStack.map((f) => f.name).join(" / ")}
          </Text>
        </View>
      ) : null}

      <CanvasView
        canvasId={currentCanvasId}
        key={currentCanvasId}
        palette={t}
        styles={styles}
        onOpenFolder={(f) => setFolderStack((s) => [...s, f])}
      />
    </View>
  );
}

function CanvasView({
  canvasId,
  palette,
  styles,
  onOpenFolder,
}: {
  canvasId: string;
  palette: Palette;
  styles: ReturnType<typeof makeStyles>;
  onOpenFolder: (f: { id: string; name: string }) => void;
}) {
  const {
    items,
    drawings,
    addItem,
    updateItem,
    removeItem,
    moveItemTo,
    removeFolder,
    addDrawing,
    updateDrawing,
    removeDrawing,
  } = useCanvas(canvasId);

  const [drawing, setDrawing] = useState(false);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [penWidth, setPenWidth] = useState(4);
  const [inkPickerOpen, setInkPickerOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);

  const drawRef = useRef<DrawCaptureHandle>(null);
  const scroll = useRef({ x: 0, y: 0 });
  const viewport = useRef({ w: 0, h: 0 });

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

  const addText = () =>
    addItem({ kind: "text", text: "", color: colors.noteColors[0], ...centerXY() });
  const addTodo = () =>
    addItem({
      kind: "todo",
      title: "",
      color: colors.noteColors[1],
      entries: [{ id: uid("t"), text: "", done: false }],
      ...centerXY(),
    });
  const addFolder = () => addItem({ kind: "folder", name: "", ...centerXY() });

  // Drop an item onto a folder → move it into that folder's canvas.
  const handleItemDrop = (item: CanvasItem, nx: number, ny: number) => {
    const cx = nx + 84;
    const cy = ny + 44;
    const target = items.find(
      (it) =>
        it.kind === "folder" &&
        it.id !== item.id &&
        cx >= it.x &&
        cx <= it.x + FOLDER_W &&
        cy >= it.y &&
        cy <= it.y + FOLDER_H
    );
    if (target) moveItemTo(target.id, item.id);
    else updateItem(item.id, { x: nx, y: ny });
  };

  // Alert.alert is a no-op on web, so folder deletes use an AlertDialog.
  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);

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

  const finishDrawing = () => {
    const shape = drawRef.current?.commit();
    if (shape) addDrawing(shape);
    setDrawing(false);
  };
  const toggleDraw = () => {
    if (drawing) finishDrawing();
    else {
      setSelectedDrawing(null);
      setDrawing(true);
    }
  };

  const onHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.x = e.nativeEvent.contentOffset.x;
  };
  const onVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.y = e.nativeEvent.contentOffset.y;
  };

  return (
    <View style={styles.canvasArea}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbar}
        contentContainerStyle={styles.toolbarContent}
      >
        <ToolButton emoji="📝" label="Text" onPress={addText} styles={styles} />
        <ToolButton emoji="✅" label="To-do" onPress={addTodo} styles={styles} />
        <ToolButton emoji="🖼️" label="Image" onPress={addImage} styles={styles} />
        <ToolButton emoji="📎" label="Doc" onPress={addDocument} styles={styles} />
        <ToolButton emoji="📁" label="Folder" onPress={addFolder} styles={styles} />
        <ToolButton
          emoji="✏️"
          label={drawing ? "Drawing…" : "Draw"}
          active={drawing}
          onPress={toggleDraw}
          styles={styles}
        />
      </ScrollView>

      <GHScrollView
        style={styles.canvasScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!drawing}
        onScroll={onHScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewport.current.w = e.nativeEvent.layout.width;
          viewport.current.h = e.nativeEvent.layout.height;
        }}
      >
        <GHScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={!drawing}
          onScroll={onVScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.canvas}>
            <DotGrid color={palette.dot} />

            {drawings.map((d) => (
              <DrawingObject
                key={d.id}
                drawing={d}
                interactive={!drawing}
                selected={selectedDrawing === d.id}
                onSelect={() =>
                  setSelectedDrawing((cur) => (cur === d.id ? null : d.id))
                }
                onChange={(patch) => updateDrawing(d.id, patch)}
              />
            ))}

            {items.map((item) => (
              <Draggable
                key={item.id}
                item={item}
                disabled={drawing}
                onMoveEnd={(x, y) => handleItemDrop(item, x, y)}
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
                ) : item.kind === "folder" ? (
                  <FolderCard
                    item={item}
                    onOpen={() => onOpenFolder({ id: item.id, name: item.name || "Folder" })}
                    onRename={(name) => updateItem(item.id, { name })}
                    onDelete={() => setFolderToDelete(item)}
                  />
                ) : (
                  <DocumentCard item={item} remove={() => removeItem(item.id)} />
                )}
              </Draggable>
            ))}

            {items.length === 0 && drawings.length === 0 ? (
              <View style={cardStyles.hintNote} pointerEvents="none">
                <Text style={cardStyles.hintNoteText}>
                  Add notes, to-dos, images, docs or a folder from the toolbar —
                  drag a note onto a 📁 to file it inside. Tap Draw to sketch;
                  drag a drawing anywhere to move it, tap it to select, then
                  drag a corner handle (or pinch) to resize.
                </Text>
              </View>
            ) : null}

            {drawing ? <DrawCapture ref={drawRef} ink={ink} penWidth={penWidth} /> : null}
          </View>
        </GHScrollView>
      </GHScrollView>

      {drawing ? (
        <View style={styles.drawBar}>
          <View style={styles.drawBarRow}>
            {INK_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setInk(c)}
                style={[styles.inkSwatch, { backgroundColor: c }, ink === c && styles.inkSwatchOn]}
              />
            ))}
            <Pressable
              onPress={() => setInkPickerOpen(true)}
              style={[
                styles.inkSwatch,
                styles.inkMore,
                !INK_COLORS.includes(ink) && styles.inkSwatchOn,
                !INK_COLORS.includes(ink) && { backgroundColor: ink },
              ]}
            >
              <Text style={styles.inkMoreIcon}>🎨</Text>
            </Pressable>
            <View style={styles.drawBarSep} />
            {PEN_WIDTHS.map((pw) => (
              <Pressable
                key={pw}
                onPress={() => setPenWidth(pw)}
                style={[styles.penBtn, penWidth === pw && styles.penBtnOn]}
              >
                <View
                  style={{ width: pw, height: pw, borderRadius: pw / 2, backgroundColor: palette.text }}
                />
              </Pressable>
            ))}
          </View>
          <View style={styles.drawBarRow}>
            <Pressable style={styles.drawActionBtn} onPress={() => drawRef.current?.undo()}>
              <Text style={styles.drawActionText}>Undo</Text>
            </Pressable>
            <Pressable style={styles.drawActionBtn} onPress={() => drawRef.current?.clear()}>
              <Text style={styles.drawActionText}>Clear</Text>
            </Pressable>
            <Pressable style={[styles.drawActionBtn, styles.drawDone]} onPress={finishDrawing}>
              <Text style={[styles.drawActionText, styles.drawDoneText]}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.drawHint}>
            Sketch on the canvas, then tap Done — the strokes become one movable
            drawing.
          </Text>
        </View>
      ) : null}

      {!drawing && selectedDrawing ? (
        <View style={styles.drawBar}>
          <Text style={styles.drawHint}>
            Drag to move · drag a corner handle (or pinch) to resize
          </Text>
          <View style={styles.drawBarRow}>
            <Pressable
              style={[styles.drawActionBtn, styles.drawDelete]}
              onPress={() => {
                removeDrawing(selectedDrawing);
                setSelectedDrawing(null);
              }}
            >
              <Text style={[styles.drawActionText, styles.drawDeleteText]}>
                🗑  Delete drawing
              </Text>
            </Pressable>
            <Pressable
              style={[styles.drawActionBtn, styles.drawDone]}
              onPress={() => setSelectedDrawing(null)}
            >
              <Text style={[styles.drawActionText, styles.drawDoneText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal
        visible={inkPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInkPickerOpen(false)}
      >
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Ink color</Text>
              <Pressable onPress={() => setInkPickerOpen(false)} hitSlop={8}>
                <Text style={styles.pickerDone}>Done</Text>
              </Pressable>
            </View>
            <ColorPicker
              value={ink}
              onChange={setInk}
              label="Pick any color"
              presets={INK_PRESETS}
            />
          </View>
        </View>
      </Modal>

      {folderToDelete ? (
        <DeleteFolderDialog
          folder={folderToDelete}
          onCancel={() => setFolderToDelete(null)}
          onConfirm={() => {
            removeFolder(folderToDelete.id);
            setFolderToDelete(null);
          }}
        />
      ) : null}
    </View>
  );
}

type FolderItem = Extract<CanvasItem, { kind: "folder" }>;

// Existing behavior: deleting a folder removes everything filed inside it
// (see store.removeFolder). Spell out what will be lost before doing it.
function DeleteFolderDialog({
  folder,
  onCancel,
  onConfirm,
}: {
  folder: FolderItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { items, drawings } = useCanvas(folder.id);
  const n = items.length + drawings.length;
  const name = folder.name || "Folder";
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title="Delete folder?"
      description={
        n > 0
          ? `Are you sure you want to delete "${name}"? The ${n} item${n === 1 ? "" : "s"} inside it (and any subfolders) will be deleted too. This action cannot be undone.`
          : `Are you sure you want to delete "${name}"? It's empty. This action cannot be undone.`
      }
      onConfirm={onConfirm}
    />
  );
}

function ToolButton({
  emoji,
  label,
  active,
  onPress,
  styles,
}: {
  emoji: string;
  label: string;
  active?: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable style={[styles.toolBtn, active && styles.toolBtnActive]} onPress={onPress}>
      <Text style={styles.toolEmoji}>{emoji}</Text>
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// Theme-independent bits: sticky notes, media cards, drawing handles.
const cardStyles = StyleSheet.create({
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
  barIcon: { fontSize: 12, color: "#3A3A2A" },
  barGrip: {
    flex: 1,
    height: 4,
    marginHorizontal: spacing.xs,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
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
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    paddingVertical: 2,
  },
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

  docBody: { padding: spacing.md, alignItems: "center" },
  docIcon: { fontSize: 26 },
  docName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1A1A1A",
    textAlign: "center",
    marginTop: spacing.xs,
  },
  docMeta: { fontSize: 11, color: "#6B7280", marginTop: 2, textAlign: "center" },

  folderCard: {
    width: FOLDER_W,
    minHeight: FOLDER_H,
    borderRadius: radius.md,
    paddingBottom: spacing.sm,
    backgroundColor: "#FFE7B3",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  folderOpen: { alignItems: "center", paddingVertical: spacing.xs },
  folderIcon: { fontSize: 34 },
  folderCount: { fontSize: 10, color: "rgba(0,0,0,0.5)", marginTop: 2, fontWeight: "600" },
  folderName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3A3A2A",
    textAlign: "center",
    paddingHorizontal: spacing.xs,
    paddingTop: 2,
  },

  hintNote: {
    position: "absolute",
    top: 60,
    left: 40,
    width: 230,
    backgroundColor: "#FFF7C2",
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  hintNoteText: { fontSize: 13, color: "#4A4A2A", lineHeight: 18 },

  // Offset by the handle padding so the drawing itself sits at (x, y).
  drawingObj: { position: "absolute", top: -HANDLE_PAD, left: -HANDLE_PAD },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: colors.accent,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  noteDate: {
    fontSize: 11,
    color: "rgba(0,0,0,0.5)",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    fontWeight: "600",
  },
  drawingObjSelected: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderStyle: "dashed",
    borderRadius: 4,
  },
});

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { fontSize: 24, fontWeight: "700", color: t.text },
    subtitle: { fontSize: 13, color: t.muted, marginTop: spacing.xs },

    tabBarWrap: { borderBottomWidth: 1, borderBottomColor: t.border },
    tabBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.xs },
    tab: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: 999,
      backgroundColor: t.surface,
    },
    tabActive: { backgroundColor: colors.accent },
    tabDot: { width: 8, height: 8, borderRadius: 4 },
    tabText: { fontSize: 13, fontWeight: "600", color: t.text },
    tabTextActive: { color: "#FFFFFF" },

    breadcrumb: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
    },
    crumbBack: { fontSize: 14, fontWeight: "700", color: colors.accent },
    crumbPath: { flex: 1, fontSize: 12, color: t.muted },

    canvasArea: { flex: 1 },
    toolbar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.border },
    toolbarContent: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    toolBtn: {
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      minWidth: 58,
    },
    toolBtnActive: {
      backgroundColor: t.scheme === "dark" ? "#1E3050" : "#E9F1FF",
      borderColor: colors.accent,
    },
    toolEmoji: { fontSize: 18 },
    toolLabel: { fontSize: 11, color: t.text, marginTop: 2, fontWeight: "600" },
    toolLabelActive: { color: colors.accent },

    canvasScroll: { flex: 1 },
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, backgroundColor: t.surface },

    drawBar: {
      position: "absolute",
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.md,
      backgroundColor: t.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      padding: spacing.sm,
      gap: spacing.sm,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    drawBarRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    drawBarSep: { width: 1, height: 24, backgroundColor: t.border, marginHorizontal: spacing.xs },
    inkSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: t.border },
    inkSwatchOn: { borderColor: t.text },
    inkMore: {
      backgroundColor: t.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    inkMoreIcon: { fontSize: 12 },
    penBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: "center",
      justifyContent: "center",
    },
    penBtnOn: { borderColor: colors.accent },
    drawActionBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    drawActionText: { fontSize: 13, fontWeight: "700", color: t.text },
    drawDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    drawDoneText: { color: "#FFFFFF" },
    drawDelete: { backgroundColor: colors.danger, borderColor: colors.danger, flex: 1 },
    drawDeleteText: { color: "#FFFFFF" },
    drawHint: { fontSize: 11, color: t.muted, textAlign: "center" },

    pickerBackdrop: { flex: 1, backgroundColor: t.overlay, justifyContent: "flex-end" },
    pickerSheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pickerTitle: { fontSize: 18, fontWeight: "700", color: t.text },
    pickerDone: { fontSize: 15, fontWeight: "700", color: colors.accent },
  });
