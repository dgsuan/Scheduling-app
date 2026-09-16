import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Image,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
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
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { useTheme } from "@/context/theme";
import {
  GENERAL_CANVAS,
  useAllCanvases,
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
import { ImageLightbox } from "@/components/ImageLightbox";
import { PopIn } from "@/components/PopIn";
import { useToast } from "@/components/Toaster";
import { isEphemeralUri, pickedImageToStored } from "@/lib/imageData";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Icon } from "@/components/ui/icon";
import { Text as UIText } from "@/components/ui/text";
import { formatShortDate } from "@/lib/calendar";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";
import {
  Folder as FolderIcon,
  Image as ImageIcon,
  ListTodo,
  Palette as PaletteIcon,
  Paperclip,
  PenLine,
  Type as TypeIcon,
  X,
  type LucideIcon,
} from "lucide-react-native";

// Freeform "open canvas" notes (Miro / Apple-Freeform style). One shared
// canvas plus a canvas per enrolled course, chosen from the tab strip.
// Each canvas holds draggable items (text, to-do, image, document) and
// freehand ink; a finished sketch becomes one movable, resizable object.

const DOT_SPACING = 28;
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 2600;

const CARD_W = 200;
const TEXT_W = 168;
// Sticky notes and to-do lists resize by their bottom-right corner.
const MIN_CARD_W = 132;
const MAX_CARD_W = 560;
const MIN_TEXT_H = 56;
const MAX_TEXT_H = 700;
const DEFAULT_TEXT_H = 72;
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
  isNew,
  highlight,
  onMoveEnd,
  children,
}: {
  item: CanvasItem;
  disabled: boolean;
  /** Briefly ring the item (e.g. after jumping to it from search). */
  highlight?: boolean;
  /** Created after the canvas opened → spring in instead of popping. */
  isNew?: boolean;
  onMoveEnd: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const tx = useRef(new Animated.Value(item.x)).current;
  const ty = useRef(new Animated.Value(item.y)).current;
  const startPos = useRef({ x: item.x, y: item.y });
  // Picked-up feel while dragging: a tiny scale and a raised z-order.
  const lift = useRef(new Animated.Value(0)).current;
  const [lifted, setLifted] = useState(false);

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
        .onStart(() => {
          setLifted(true);
          Animated.spring(lift, { toValue: 1, useNativeDriver: false, speed: 28, bounciness: 6 }).start();
        })
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
        })
        .onFinalize(() => {
          setLifted(false);
          Animated.spring(lift, { toValue: 0, useNativeDriver: false, speed: 28, bounciness: 4 }).start();
        }),
    [disabled, onMoveEnd, tx, ty, lift]
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          cardStyles.itemWrap,
          {
            zIndex: lifted ? 20 : 1,
            transform: [
              { translateX: tx },
              { translateY: ty },
              { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) },
            ],
          },
        ]}
      >
        <View
          aria-selected={highlight || undefined}
          style={highlight ? { borderRadius: 12, padding: 3, margin: -3, borderWidth: 2, borderColor: colors.accent } : undefined}
        >
          {isNew || highlight ? <PopIn key={highlight ? "hl" : "new"}>{children}</PopIn> : children}
        </View>
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
          <PaletteIcon size={13} color="rgba(0,0,0,0.55)" />
        </Pressable>
      ) : (
        <View style={cardStyles.barBtn} />
      )}
      <View style={cardStyles.barGrip} />
      <Pressable onPress={onDelete} hitSlop={6} style={cardStyles.barBtn}>
        <X size={13} color="rgba(0,0,0,0.55)" />
      </Pressable>
    </View>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Bottom-right grip: drag to resize the card it sits in. */
function ResizeHandle({
  label,
  onStart,
  onResize,
  onCommit,
}: {
  label: string;
  onStart: () => void;
  onResize: (dx: number, dy: number) => void;
  onCommit: () => void;
}) {
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Starts at the first pixel, so it wins over the card's own drag gesture.
        .runOnJS(true)
        .minDistance(0)
        .onBegin(onStart)
        .onUpdate((e) => onResize(e.translationX, e.translationY))
        .onEnd(onCommit)
        .onFinalize(onCommit),
    [onStart, onResize, onCommit]
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={10}
        className="web:cursor-nwse-resize"
        style={cardStyles.cardHandle}
      />
    </GestureDetector>
  );
}

function TextCard({
  item,
  update,
  remove,
  onResizeStart,
  onResizeEnd,
}: {
  item: Extract<CanvasItem, { kind: "text" }>;
  update: (patch: Partial<CanvasItem>) => void;
  remove: () => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}) {
  const cycle = () => {
    const i = colors.noteColors.indexOf(item.color);
    update({ color: colors.noteColors[(i + 1) % colors.noteColors.length] });
  };

  const [size, setSize] = useState({ w: item.width ?? TEXT_W, h: item.height ?? 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const origin = useRef(size);
  useEffect(() => {
    setSize({ w: item.width ?? TEXT_W, h: item.height ?? 0 });
  }, [item.width, item.height]);

  return (
    <View testID={`canvas-card-${item.id}`} style={[cardStyles.card, { backgroundColor: item.color, width: size.w }]}>
      <ItemBar onCycleColor={cycle} onDelete={remove} />
      <TextInput
        style={[cardStyles.textInput, size.h ? { height: size.h } : null]}
        value={item.text}
        onChangeText={(text) => update({ text })}
        placeholder="Type…"
        placeholderTextColor="rgba(0,0,0,0.35)"
        multiline
      />
      {item.date ? (
        <Text style={cardStyles.noteDate}>
          {formatShortDate(item.date)}
          {item.endDate ? ` – ${formatShortDate(item.endDate)}` : ""}
        </Text>
      ) : null}
      <ResizeHandle
        label="Resize note"
        onStart={() => {
          origin.current = { w: sizeRef.current.w, h: sizeRef.current.h || DEFAULT_TEXT_H };
          onResizeStart();
        }}
        onResize={(dx, dy) =>
          setSize({
            w: clamp(origin.current.w + dx, MIN_CARD_W, MAX_CARD_W),
            h: clamp(origin.current.h + dy, MIN_TEXT_H, MAX_TEXT_H),
          })
        }
        onCommit={() => {
          update({ width: Math.round(sizeRef.current.w), height: Math.round(sizeRef.current.h || DEFAULT_TEXT_H) });
          onResizeEnd();
        }}
      />
    </View>
  );
}

function TodoCard({
  item,
  update,
  remove,
  onResizeStart,
  onResizeEnd,
}: {
  item: Extract<CanvasItem, { kind: "todo" }>;
  update: (patch: Partial<CanvasItem>) => void;
  remove: () => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}) {
  const setEntries = (entries: TodoEntry[]) => update({ entries });
  const cycle = () => {
    const i = colors.noteColors.indexOf(item.color);
    update({ color: colors.noteColors[(i + 1) % colors.noteColors.length] });
  };
  const [width, setWidth] = useState(item.width ?? CARD_W);
  const widthRef = useRef(width);
  widthRef.current = width;
  const origin = useRef(width);
  useEffect(() => setWidth(item.width ?? CARD_W), [item.width]);
  return (
    <View testID={`canvas-card-${item.id}`} style={[cardStyles.card, { backgroundColor: item.color, width }]}>
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
      <ResizeHandle
        label="Resize to-do"
        onStart={() => {
          origin.current = widthRef.current;
          onResizeStart();
        }}
        onResize={(dx) => setWidth(clamp(origin.current + dx, MIN_CARD_W, MAX_CARD_W))}
        onCommit={() => {
          update({ width: Math.round(widthRef.current) });
          onResizeEnd();
        }}
      />
    </View>
  );
}

function ImageCard({
  item,
  remove,
  onOpen,
}: {
  item: Extract<CanvasItem, { kind: "image" }>;
  remove: () => void;
  onOpen: () => void;
}) {
  const ratio = item.width && item.height ? item.height / item.width : 0.75;
  let w = IMG_MAX_W;
  let h = w * ratio;
  if (h > IMG_MAX_H) {
    h = IMG_MAX_H;
    w = h / ratio;
  }
  // Older web builds saved short-lived blob: URLs that no longer load.
  const broken = isEphemeralUri(item.uri);
  return (
    <View style={[cardStyles.card, cardStyles.mediaCard, { width: w + 4 }]}>
      <ItemBar onDelete={remove} />
      {broken ? (
        <View style={[cardStyles.brokenImage, { width: w, height: Math.max(90, Math.min(h, 140)) }]}>
          <Text style={cardStyles.brokenTitle}>Image unavailable</Text>
          <Text style={cardStyles.brokenHint}>
            It was saved by an older version and can&apos;t be loaded. Delete it and add the image again.
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Open image"
          className="web:cursor-zoom-in web:transition-opacity web:hover:opacity-90"
        >
          <Image source={{ uri: item.uri }} style={{ width: w, height: h, borderRadius: 4 }} />
        </Pressable>
      )}
    </View>
  );
}

function DocumentCard({
  item,
  remove,
  onOpenError,
}: {
  item: Extract<CanvasItem, { kind: "document" }>;
  remove: () => void;
  onOpenError?: () => void;
}) {
  const kb = item.size ? Math.max(1, Math.round(item.size / 1024)) : null;
  return (
    <View style={[cardStyles.card, { width: CARD_W, backgroundColor: "#FFFFFF" }]}>
      <ItemBar onDelete={remove} />
      <Pressable
        style={cardStyles.docBody}
        onPress={() =>
          Linking.openURL(item.uri).catch(() => onOpenError?.())
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
          <X size={13} color="rgba(0,0,0,0.55)" />
        </Pressable>
      </View>
      <Pressable onPress={onOpen} style={cardStyles.folderOpen}>
        <FolderIcon size={34} color="#B7862C" fill="#F1C56A" strokeWidth={1.5} />
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
  const { desktop } = useBreakpoint();

  const tabs = [
    { id: GENERAL_CANVAS, label: "General", color: colors.accent },
    ...courses
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ id: c.id, label: c.code, color: c.color })),
  ];

  const [active, setActive] = useState<string>(GENERAL_CANVAS);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const canvases = useAllCanvases();

  // Deep link from search: ?canvas=<id>&item=<id> opens the notebook (and
  // folder path) holding the item, then scrolls to and highlights it.
  const params = useLocalSearchParams<{ canvas?: string; item?: string }>();
  useEffect(() => {
    if (!params.canvas) return;
    const path: { id: string; name: string }[] = [];
    let cursor = params.canvas;
    for (let guard = 0; guard < 20; guard++) {
      if (cursor === GENERAL_CANVAS || courses.some((c) => c.id === cursor)) break;
      const parent = Object.entries(canvases).find(([, data]) => data.items.some((it) => it.kind === "folder" && it.id === cursor));
      if (!parent) break;
      const folder = parent[1].items.find((it) => it.id === cursor);
      path.unshift({ id: cursor, name: folder && folder.kind === "folder" ? folder.name || "Folder" : "Folder" });
      cursor = parent[0];
    }
    setActive(cursor === GENERAL_CANVAS || courses.some((c) => c.id === cursor) ? cursor : GENERAL_CANVAS);
    setFolderStack(path);
    setFocusItem(params.item ?? null);
    // Deferred: on a cold load from a link the root navigator isn't mounted yet.
    setTimeout(() => router.setParams({ canvas: undefined, item: undefined }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.canvas, params.item]);

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
      <View style={[styles.header, desktop && { paddingHorizontal: 40, paddingTop: 40 }]}>
        <ScreenHeader title="Notes" subtitle="An open canvas — put anything, anywhere." />
      </View>

      {/* Notebook switcher: quiet underline tabs rather than loud pills. */}
      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.tabBar, desktop && { paddingHorizontal: 28 }]}
        >
          {tabs.map((tab) => {
            const on = active === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => selectTab(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                className={cn(
                  "flex-row items-center gap-2 rounded-md px-3 pb-3 pt-2 web:transition-colors web:duration-150",
                  !on && "web:hover:bg-accent/60"
                )}
              >
                <View className="size-2 rounded-full" style={{ backgroundColor: tab.color }} />
                <UIText className={cn("text-sm", on ? "text-foreground font-semibold" : "text-muted-foreground font-medium")}>
                  {tab.label}
                </UIText>
                {on ? <View className="bg-primary absolute bottom-0 left-3 right-3 h-0.5 rounded-full" /> : null}
              </Pressable>
            );
          })}
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
        focusItemId={focusItem}
        onFocusHandled={() => setFocusItem(null)}
      />
    </View>
  );
}

function CanvasView({
  canvasId,
  palette,
  styles,
  onOpenFolder,
  focusItemId,
  onFocusHandled,
}: {
  canvasId: string;
  palette: Palette;
  styles: ReturnType<typeof makeStyles>;
  onOpenFolder: (f: { id: string; name: string }) => void;
  focusItemId?: string | null;
  onFocusHandled?: () => void;
}) {
  const {
    ready,
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
  const { toast } = useToast();

  const [drawing, setDrawing] = useState(false);
  /** While a card is being resized, its drag gesture stays out of the way. */
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [penWidth, setPenWidth] = useState(4);
  const [inkPickerOpen, setInkPickerOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);

  const drawRef = useRef<DrawCaptureHandle>(null);
  // Items present when the canvas opened don't animate; later ones do.
  const initialIds = useRef<Set<string> | null>(null);
  if (initialIds.current === null && ready) initialIds.current = new Set(items.map((it) => it.id));
  const scroll = useRef({ x: 0, y: 0 });
  const viewport = useRef({ w: 0, h: 0 });
  const hScrollRef = useRef<any>(null);
  const vScrollRef = useRef<any>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Scroll a searched-for item into view and flash a highlight on it.
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  useEffect(() => {
    if (!focusItemId || !ready) return;
    const item = items.find((it) => it.id === focusItemId);
    if (!item) {
      onFocusHandled?.();
      return;
    }
    // Wait for layout, scroll, highlight — and only then mark the request
    // handled (clearing it earlier would cancel this timer via cleanup).
    const t = setTimeout(() => {
      hScrollRef.current?.scrollTo?.({ x: Math.max(0, item.x - viewport.current.w / 2 + CARD_W / 2), animated: true });
      vScrollRef.current?.scrollTo?.({ y: Math.max(0, item.y - viewport.current.h / 3), animated: true });
      setHighlightId(item.id);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 1800);
      onFocusHandled?.();
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId, ready]);

  // Middle of what you're looking at, stepped a little each time so new
  // items cascade instead of landing on top of each other.
  const centerXY = () => {
    const step = (items.length % 6) * 26;
    return {
      x: Math.min(
        Math.max(0, scroll.current.x + viewport.current.w / 2 - CARD_W / 2 + step),
        CANVAS_WIDTH - CARD_W
      ),
      y: Math.min(
        Math.max(0, scroll.current.y + viewport.current.h / 2 - 60 + step),
        CANVAS_HEIGHT - 120
      ),
    };
  };

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
      toast({ message: "Photo access needed", description: "Allow photo access to add an image.", tone: "danger" });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (res.canceled) return;
    try {
      const stored = await pickedImageToStored(res.assets[0]);
      addItem({ kind: "image", ...stored, ...centerXY() });
    } catch {
      toast({ message: "Couldn't add that image", description: "Try a JPEG or PNG file.", tone: "danger" });
    }
  };

  const [viewingImageId, setViewingImageId] = useState<string | null>(null);
  const viewingImage = items.find(
    (it): it is Extract<CanvasItem, { kind: "image" }> => it.kind === "image" && it.id === viewingImageId
  );

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
      <GHScrollView
        ref={hScrollRef}
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
          ref={vScrollRef}
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
                disabled={drawing || resizingId === item.id}
                isNew={!!initialIds.current && !initialIds.current.has(item.id)}
                highlight={highlightId === item.id}
                onMoveEnd={(x, y) => handleItemDrop(item, x, y)}
              >
                {item.kind === "text" ? (
                  <TextCard
                    item={item}
                    update={(p) => updateItem(item.id, p)}
                    remove={() => removeItem(item.id)}
                    onResizeStart={() => setResizingId(item.id)}
                    onResizeEnd={() => setResizingId(null)}
                  />
                ) : item.kind === "todo" ? (
                  <TodoCard
                    item={item}
                    update={(p) => updateItem(item.id, p)}
                    remove={() => removeItem(item.id)}
                    onResizeStart={() => setResizingId(item.id)}
                    onResizeEnd={() => setResizingId(null)}
                  />
                ) : item.kind === "image" ? (
                  <ImageCard
                    item={item}
                    remove={() => removeItem(item.id)}
                    onOpen={() => setViewingImageId(item.id)}
                  />
                ) : item.kind === "folder" ? (
                  <FolderCard
                    item={item}
                    onOpen={() => onOpenFolder({ id: item.id, name: item.name || "Folder" })}
                    onRename={(name) => updateItem(item.id, { name })}
                    onDelete={() => setFolderToDelete(item)}
                  />
                ) : (
                  <DocumentCard
                    item={item}
                    remove={() => removeItem(item.id)}
                    onOpenError={() =>
                      toast({ message: "Can't open this file", description: "No app is available to open it.", tone: "danger" })
                    }
                  />
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

      {/* Floating tool dock — out of the way of the page, close to the canvas. */}
      {!drawing && !selectedDrawing ? (
        <View pointerEvents="box-none" style={styles.toolDock}>
          {/* Narrow windows: the dock scrolls sideways instead of running off screen. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dockScroll}
            contentContainerStyle={styles.dockScrollContent}
            accessibilityLabel="Notes toolbar"
          >
            <View className="bg-card border-border flex-row items-center gap-0.5 rounded-xl border p-1 shadow-lg shadow-black/10">
              <ToolButton icon={TypeIcon} label="Text" onPress={addText} />
              <ToolButton icon={ListTodo} label="To-do" onPress={addTodo} />
              <ToolButton icon={ImageIcon} label="Image" onPress={addImage} />
              <ToolButton icon={Paperclip} label="File" onPress={addDocument} />
              <ToolButton icon={FolderIcon} label="Folder" onPress={addFolder} />
              <View className="bg-border mx-1 h-7 w-px" />
              <ToolButton icon={PenLine} label="Draw" onPress={toggleDraw} />
            </View>
          </ScrollView>
        </View>
      ) : null}

      {drawing ? (
        <View pointerEvents="box-none" style={styles.toolDock}>
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
        </View>
      ) : null}

      {!drawing && selectedDrawing ? (
        <View pointerEvents="box-none" style={styles.toolDock}>
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
                Delete drawing
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

      {viewingImage ? (
        <ImageLightbox
          uri={viewingImage.uri}
          width={viewingImage.width}
          height={viewingImage.height}
          originalUri={viewingImage.originalUri}
          title="Image"
          onClose={() => setViewingImageId(null)}
          onSave={
            Platform.OS === "web"
              ? (next) =>
                  updateItem(viewingImage.id, {
                    ...next,
                    // Keep the very first version so edits can always be reverted.
                    originalUri: viewingImage.originalUri ?? viewingImage.uri,
                    originalWidth: viewingImage.originalWidth ?? viewingImage.width,
                    originalHeight: viewingImage.originalHeight ?? viewingImage.height,
                  })
              : undefined
          }
          onRevert={
            viewingImage.originalUri
              ? () =>
                  updateItem(viewingImage.id, {
                    uri: viewingImage.originalUri,
                    width: viewingImage.originalWidth ?? viewingImage.width,
                    height: viewingImage.originalHeight ?? viewingImage.height,
                    originalUri: undefined,
                    originalWidth: undefined,
                    originalHeight: undefined,
                  })
              : undefined
          }
        />
      ) : null}

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
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label.toLowerCase()}`}
      className="items-center gap-0.5 rounded-lg px-3 py-1.5 web:transition-all web:duration-150 web:hover:bg-accent active:scale-95 active:bg-accent"
    >
      <Icon as={icon} size={18} className="text-foreground/80" />
      <UIText className="text-muted-foreground text-[11px] font-medium">{label}</UIText>
    </Pressable>
  );
}

// Theme-independent bits: sticky notes, media cards, drawing handles.
const cardStyles = StyleSheet.create({
  itemWrap: { position: "absolute", top: 0, left: 0 },
  // Paper-like: a soft, low shadow rather than a hard drop.
  card: {
    borderRadius: 10,
    paddingBottom: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  mediaCard: { backgroundColor: "#FFFFFF", padding: 2 },
  brokenImage: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
    borderRadius: 4,
    backgroundColor: "#F3F1EC",
    gap: 4,
  },
  brokenTitle: { fontSize: 12, fontWeight: "700", color: "#5A5346" },
  brokenHint: { fontSize: 11, color: "#7A7264", textAlign: "center", lineHeight: 15 },
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
    backgroundColor: "#FBE9C2",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
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
  cardHandle: {
    position: "absolute",
    right: 3,
    bottom: 3,
    width: 14,
    height: 14,
    borderBottomRightRadius: 8,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: "rgba(0,0,0,0.28)",
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
    screen: { flex: 1, backgroundColor: "transparent" },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },

    tabBarWrap: { borderBottomWidth: 1, borderBottomColor: t.border },
    tabBar: { paddingHorizontal: spacing.md, gap: 2 },

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
    crumbBack: { fontSize: 14, fontWeight: "700", color: t.accent },
    crumbPath: { flex: 1, fontSize: 12, color: t.muted },

    canvasArea: { flex: 1 },
    toolDock: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: spacing.lg,
      paddingHorizontal: spacing.md,
      alignItems: "center",
    },

    dockScroll: { alignSelf: "stretch", flexGrow: 0 },
    dockScrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xs },

    canvasScroll: { flex: 1 },
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, backgroundColor: t.surface },

    // Lives inside toolDock, which centers it above the canvas.
    drawBar: {
      width: "100%",
      maxWidth: 520,
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
    penBtnOn: { borderColor: t.accent },
    drawActionBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    drawActionText: { fontSize: 13, fontWeight: "700", color: t.text },
    drawDone: { backgroundColor: t.accent, borderColor: t.accent },
    drawDoneText: { color: "#FFFFFF" },
    drawDelete: { backgroundColor: "transparent", borderColor: t.danger, flex: 1, alignItems: "center" },
    drawDeleteText: { color: t.danger },
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
    pickerDone: { fontSize: 15, fontWeight: "700", color: t.accent },
  });
