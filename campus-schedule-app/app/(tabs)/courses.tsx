import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import type { Course, Meeting, Weekday } from "@/context/store";
import { useCourses } from "@/context/store";
import { formatRange, parseTime, WEEKDAY_SHORT } from "@/lib/schedule";
import {
  HUES,
  hslToHex,
  hueSwatch,
  isLight,
  LIGHTNESS_RAMP,
  normalizeHex,
} from "@/lib/color";

const DAY_CHIPS: { value: Weekday; label: string }[] = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "Th" },
  { value: 5, label: "F" },
  { value: 6, label: "Sa" },
  { value: 0, label: "Su" },
];

function emptyMeeting(): Meeting {
  return { days: [], start: "", end: "", room: "" };
}

const HUE_SAT = 68;

// Color picker: quick presets + a full hue wheel row + a lightness ramp
// for the chosen hue + freeform hex entry. Far more than the original 8.
function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hue, setHue] = useState<number>(HUES[0]);
  const [hexText, setHexText] = useState<string>(value);

  const commitHex = (raw: string) => {
    setHexText(raw);
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  return (
    <View>
      <Text style={styles.fieldLabel}>Label color</Text>

      <View style={styles.colorPreviewRow}>
        <View style={[styles.colorPreview, { backgroundColor: value }]}>
          <Text
            style={[
              styles.colorPreviewText,
              { color: isLight(value) ? "#1A1A1A" : "#FFFFFF" },
            ]}
          >
            {value}
          </Text>
        </View>
        <TextInput
          style={[styles.input, styles.hexInput]}
          value={hexText}
          onChangeText={commitHex}
          onBlur={() => setHexText(value)}
          placeholder="#4F8CFF"
          placeholderTextColor={colors.lightMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
        />
      </View>

      <Text style={styles.smallLabel}>Presets</Text>
      <View style={styles.swatchRow}>
        {colors.courseColors.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              onChange(c);
              setHexText(c);
            }}
            style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchSelected]}
          />
        ))}
      </View>

      <Text style={styles.smallLabel}>Hue</Text>
      <View style={styles.swatchRow}>
        {HUES.map((h) => {
          const sw = hueSwatch(h);
          return (
            <Pressable
              key={h}
              onPress={() => {
                setHue(h);
                const hex = hslToHex(h, HUE_SAT, 52);
                onChange(hex);
                setHexText(hex);
              }}
              style={[styles.swatch, { backgroundColor: sw }, hue === h && styles.swatchSelected]}
            />
          );
        })}
      </View>

      <Text style={styles.smallLabel}>Shade</Text>
      <View style={styles.swatchRow}>
        {LIGHTNESS_RAMP.map((l) => {
          const hex = hslToHex(hue, HUE_SAT, l);
          return (
            <Pressable
              key={l}
              onPress={() => {
                onChange(hex);
                setHexText(hex);
              }}
              style={[
                styles.swatch,
                { backgroundColor: hex },
                normalizeHex(value) === hex && styles.swatchSelected,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function meetingSummary(m: Meeting): string {
  const days = [...m.days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAY_SHORT[d])
    .join(" / ");
  const time = m.start && m.end ? formatRange(m.start, m.end) : "time not set";
  return `${days || "no days"} · ${time}${m.room ? ` · ${m.room}` : ""}`;
}

// --- Add / edit form -------------------------------------------------------

function CourseForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Course;
  onSubmit: (data: Omit<Course, "id">) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [section, setSection] = useState(initial?.section ?? "");
  const [instructor, setInstructor] = useState(initial?.instructor ?? "");
  const [color, setColor] = useState(initial?.color ?? colors.courseColors[0]);
  const [meetings, setMeetings] = useState<Meeting[]>(
    initial?.meetings.length ? initial.meetings.map((m) => ({ ...m })) : [emptyMeeting()]
  );

  const patchMeeting = (index: number, patch: Partial<Meeting>) => {
    setMeetings((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const toggleDay = (index: number, day: Weekday) => {
    setMeetings((prev) =>
      prev.map((m, i) => {
        if (i !== index) return m;
        return m.days.includes(day)
          ? { ...m, days: m.days.filter((d) => d !== day) }
          : { ...m, days: [...m.days, day] };
      })
    );
  };

  const handleSave = () => {
    if (!code.trim()) {
      Alert.alert("Course code required", "Enter at least a course code (e.g. CMSC 13).");
      return;
    }
    const cleaned: Meeting[] = [];
    for (const m of meetings) {
      const hasAny = m.days.length || m.start || m.end || m.room;
      if (!hasAny) continue; // skip fully-blank rows
      if (!m.days.length) {
        Alert.alert("Pick a day", "Each meeting time needs at least one day selected.");
        return;
      }
      const s = parseTime(m.start);
      const e = parseTime(m.end);
      if (s == null || e == null) {
        Alert.alert("Check the time", "Use 24-hour HH:MM, e.g. 14:30.");
        return;
      }
      if (e <= s) {
        Alert.alert("Check the time", "End time must be after start time.");
        return;
      }
      cleaned.push({
        days: [...m.days].sort(),
        start: m.start.trim(),
        end: m.end.trim(),
        room: m.room?.trim() || undefined,
      });
    }

    onSubmit({
      code: code.trim(),
      title: title.trim() || undefined,
      section: section.trim() || undefined,
      instructor: instructor.trim() || undefined,
      color,
      meetings: cleaned,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.modalRoot}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{initial ? "Edit course" : "Add course"}</Text>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.modalClose}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.fieldLabel}>Course code *</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="CMSC 13"
            placeholderTextColor={colors.lightMuted}
            autoCapitalize="characters"
          />

          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Programming in C"
            placeholderTextColor={colors.lightMuted}
          />

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Text style={styles.fieldLabel}>Section</Text>
              <TextInput
                style={styles.input}
                value={section}
                onChangeText={setSection}
                placeholder="N"
                placeholderTextColor={colors.lightMuted}
              />
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.fieldLabel}>Instructor</Text>
              <TextInput
                style={styles.input}
                value={instructor}
                onChangeText={setInstructor}
                placeholder="Prof. Dela Cruz"
                placeholderTextColor={colors.lightMuted}
              />
            </View>
          </View>

          <ColorField value={color} onChange={setColor} />

          <View style={styles.meetingsHeader}>
            <Text style={styles.fieldLabel}>Meeting times</Text>
            <Pressable onPress={() => setMeetings((p) => [...p, emptyMeeting()])} hitSlop={8}>
              <Text style={styles.addMeeting}>+ Add time</Text>
            </Pressable>
          </View>

          {meetings.map((m, i) => (
            <View key={i} style={styles.meetingCard}>
              {meetings.length > 1 ? (
                <Pressable
                  style={styles.meetingRemove}
                  onPress={() => setMeetings((p) => p.filter((_, idx) => idx !== i))}
                  hitSlop={8}
                >
                  <Text style={styles.meetingRemoveText}>Remove</Text>
                </Pressable>
              ) : null}

              <View style={styles.dayChipRow}>
                {DAY_CHIPS.map((d) => {
                  const on = m.days.includes(d.value);
                  return (
                    <Pressable
                      key={d.value}
                      onPress={() => toggleDay(i, d.value)}
                      style={[styles.dayChip, on && styles.dayChipOn]}
                    >
                      <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                        {d.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Text style={styles.smallLabel}>Start (HH:MM)</Text>
                  <TextInput
                    style={styles.input}
                    value={m.start}
                    onChangeText={(t) => patchMeeting(i, { start: t })}
                    placeholder="14:30"
                    placeholderTextColor={colors.lightMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={styles.rowItem}>
                  <Text style={styles.smallLabel}>End (HH:MM)</Text>
                  <TextInput
                    style={styles.input}
                    value={m.end}
                    onChangeText={(t) => patchMeeting(i, { end: t })}
                    placeholder="16:00"
                    placeholderTextColor={colors.lightMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>

              <Text style={styles.smallLabel}>Room</Text>
              <TextInput
                style={styles.input}
                value={m.room}
                onChangeText={(t) => patchMeeting(i, { room: t })}
                placeholder="CS Laboratory 2"
                placeholderTextColor={colors.lightMuted}
              />
            </View>
          ))}
        </ScrollView>

        <View style={styles.modalActions}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={onCancel}>
            <Text style={styles.buttonSecondaryText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.buttonPrimary]} onPress={handleSave}>
            <Text style={styles.buttonPrimaryText}>{initial ? "Save changes" : "Add course"}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Screen --------------------------------------------------------------

export default function CoursesScreen() {
  const { courses, addCourse, updateCourse, removeCourse } = useCourses();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);

  const sorted = useMemo(
    () => [...courses].sort((a, b) => a.code.localeCompare(b.code)),
    [courses]
  );

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (course: Course) => {
    setEditing(course);
    setFormOpen(true);
  };
  const confirmRemove = (course: Course) => {
    Alert.alert("Remove course", `Remove ${course.code}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeCourse(course.id) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>My Courses</Text>
        <Text style={styles.subtitle}>
          Add the classes you&apos;re enrolled in. The Schedule and Calendar tabs
          read from this list.
        </Text>

        {sorted.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No courses yet.</Text>
            <Text style={styles.emptyHint}>Tap “Add course” to get started.</Text>
          </View>
        ) : (
          sorted.map((course) => (
            <View key={course.id} style={styles.courseCard}>
              <View style={[styles.colorBar, { backgroundColor: course.color }]} />
              <View style={styles.courseBody}>
                <Text style={styles.courseCode}>
                  {course.code}
                  {course.section ? `  (${course.section})` : ""}
                </Text>
                {course.title ? <Text style={styles.courseTitle}>{course.title}</Text> : null}
                {course.instructor ? (
                  <Text style={styles.courseMeta}>{course.instructor}</Text>
                ) : null}
                {course.meetings.length ? (
                  course.meetings.map((m, i) => (
                    <Text key={i} style={styles.courseMeeting}>
                      {meetingSummary(m)}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.courseMeeting}>No meeting times set</Text>
                )}

                <View style={styles.cardActions}>
                  <Pressable onPress={() => openEdit(course)} hitSlop={6}>
                    <Text style={styles.actionEdit}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmRemove(course)} hitSlop={6}>
                    <Text style={styles.actionRemove}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={openAdd} accessibilityLabel="Add course">
        <Text style={styles.fabText}>+ Add course</Text>
      </Pressable>

      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <CourseForm
          initial={editing ?? undefined}
          onCancel={() => setFormOpen(false)}
          onSubmit={(data) => {
            if (editing) updateCourse(editing.id, data);
            else addCourse(data);
            setFormOpen(false);
          }}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightBg },
  content: { padding: spacing.lg, paddingBottom: 120 },
  title: { fontSize: 24, fontWeight: "700", color: colors.lightText },
  subtitle: {
    fontSize: 13,
    color: colors.lightMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },

  emptyCard: {
    backgroundColor: colors.lightSurface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: { fontSize: 15, fontWeight: "600", color: colors.lightText },
  emptyHint: { fontSize: 13, color: colors.lightMuted, marginTop: spacing.xs },

  courseCard: {
    flexDirection: "row",
    backgroundColor: colors.lightSurface,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  colorBar: { width: 6 },
  courseBody: { flex: 1, padding: spacing.md },
  courseCode: { fontSize: 16, fontWeight: "700", color: colors.lightText },
  courseTitle: { fontSize: 14, color: colors.lightText, marginTop: 2 },
  courseMeta: { fontSize: 13, color: colors.lightMuted, marginTop: 2 },
  courseMeeting: { fontSize: 13, color: colors.lightMuted, marginTop: spacing.xs },
  cardActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  actionEdit: { fontSize: 13, fontWeight: "700", color: colors.accent },
  actionRemove: { fontSize: 13, fontWeight: "700", color: colors.danger },

  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },

  // Modal / form
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.lightBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "92%",
    paddingBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.lightText },
  modalClose: { fontSize: 18, color: colors.lightMuted },
  modalScroll: { paddingHorizontal: spacing.lg },
  modalScrollContent: { paddingBottom: spacing.lg },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.lightText,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  smallLabel: {
    fontSize: 12,
    color: colors.lightMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
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
  row: { flexDirection: "row", gap: spacing.sm },
  rowItem: { flex: 1 },

  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xs },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  swatchSelected: { borderColor: colors.lightText },
  colorPreviewRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  colorPreview: {
    width: 96,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  colorPreviewText: { fontSize: 11, fontWeight: "700" },
  hexInput: { flex: 1 },

  meetingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addMeeting: { fontSize: 13, fontWeight: "700", color: colors.accent, marginTop: spacing.md },
  meetingCard: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  meetingRemove: { alignSelf: "flex-end" },
  meetingRemoveText: { fontSize: 12, fontWeight: "700", color: colors.danger },
  dayChipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  dayChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  dayChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayChipText: { fontSize: 13, fontWeight: "600", color: colors.lightText },
  dayChipTextOn: { color: "#FFFFFF" },

  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  button: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radius.sm, alignItems: "center" },
  buttonSecondary: { backgroundColor: colors.lightSurface, borderWidth: 1, borderColor: colors.lightBorder },
  buttonSecondaryText: { color: colors.lightText, fontWeight: "700" },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonPrimaryText: { color: "#FFFFFF", fontWeight: "700" },
});
