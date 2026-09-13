import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
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

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { useTheme } from "@/context/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { Course, Meeting, Weekday } from "@/context/store";
import { useCourses } from "@/context/store";
import {
  formatRange,
  parse12h,
  parseTime,
  to12h,
  WEEKDAY_SHORT,
  type Period,
} from "@/lib/schedule";
import { ColorPicker } from "@/components/ColorPicker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GradesDialog } from "@/components/grades/GradesDialog";
import { GwaSummary } from "@/components/grades/GwaSummary";
import { useGrades } from "@/context/store";
import { DEFAULT_UNITS, courseStanding, formatGrade } from "@/lib/grades";
import { AddSharedCourseDialog, ShareCourseDialog } from "@/components/courses/CourseSharing";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { isSupabaseConfigured } from "@/lib/supabase";

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

function meetingSummary(m: Meeting): string {
  const days = [...m.days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAY_SHORT[d])
    .join(" / ");
  const time = m.start && m.end ? formatRange(m.start, m.end) : "time not set";
  return `${days || "no days"} · ${time}${m.room ? ` · ${m.room}` : ""}`;
}

// 12-hour time entry with an AM/PM toggle. Lenient: "1243" reads as
// 12:43, "930" as 9:30, "9" as 9:00. Reports back a stored 24h "HH:MM".
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v24: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const initial = to12h(value);
  const [text, setText] = useState(
    initial ? `${initial.hour}:${String(initial.minute).padStart(2, "0")}` : ""
  );
  const [period, setPeriod] = useState<Period>(initial?.period ?? "AM");

  const push = (raw: string, p: Period) => {
    const v24 = parse12h(raw, p);
    onChange(v24 ?? "");
  };

  const handleText = (raw: string) => {
    setText(raw);
    push(raw, period);
  };
  const handlePeriod = (p: Period) => {
    setPeriod(p);
    push(text, p);
  };
  const handleBlur = () => {
    const parts = to12h(parse12h(text, period) ?? "");
    if (parts) {
      setText(`${parts.hour}:${String(parts.minute).padStart(2, "0")}`);
      setPeriod(parts.period);
    }
  };

  return (
    <View style={styles.rowItem}>
      <Text style={styles.smallLabel}>{label}</Text>
      <View style={styles.timeRow}>
        <TextInput
          style={[styles.input, styles.timeInput]}
          value={text}
          onChangeText={handleText}
          onBlur={handleBlur}
          placeholder="12:43"
          placeholderTextColor={t.muted}
          keyboardType="numbers-and-punctuation"
        />
        <View style={styles.periodToggle}>
          {(["AM", "PM"] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => handlePeriod(p)}
              style={[styles.periodBtn, period === p && styles.periodBtnOn]}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextOn]}>
                {p}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
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
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [code, setCode] = useState(initial?.code ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [section, setSection] = useState(initial?.section ?? "");
  const [instructor, setInstructor] = useState(initial?.instructor ?? "");
  const [units, setUnits] = useState(initial?.units != null ? String(initial.units) : "");
  // Inline errors: Alert.alert does nothing on web.
  const [formError, setFormError] = useState<string | null>(null);
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
    setFormError(null);
    if (!code.trim()) {
      setFormError("Enter at least a course code (e.g. CMSC 13).");
      return;
    }
    const cleaned: Meeting[] = [];
    for (const m of meetings) {
      const hasAny = m.days.length || m.start || m.end || m.room;
      if (!hasAny) continue; // skip fully-blank rows
      if (!m.days.length) {
        setFormError("Each meeting time needs at least one day selected.");
        return;
      }
      const s = parseTime(m.start);
      const e = parseTime(m.end);
      if (s == null || e == null) {
        setFormError("Enter a start and end time like 12:43, and pick AM/PM.");
        return;
      }
      if (e <= s) {
        setFormError("End time must be after start time.");
        return;
      }
      cleaned.push({
        days: [...m.days].sort(),
        start: m.start.trim(),
        end: m.end.trim(),
        room: m.room?.trim() || undefined,
      });
    }

    const unitsNum = units.trim() ? Number(units) : undefined;
    if (unitsNum !== undefined && (!isFinite(unitsNum) || unitsNum <= 0 || unitsNum > 30)) {
      setFormError("Units should be a number like 3.");
      return;
    }

    onSubmit({
      code: code.trim(),
      title: title.trim() || undefined,
      section: section.trim() || undefined,
      instructor: instructor.trim() || undefined,
      color,
      meetings: cleaned,
      units: unitsNum,
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
            placeholderTextColor={t.muted}
            autoCapitalize="characters"
          />

          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Programming in C"
            placeholderTextColor={t.muted}
          />

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Text style={styles.fieldLabel}>Section</Text>
              <TextInput
                style={styles.input}
                value={section}
                onChangeText={setSection}
                placeholder="N"
                placeholderTextColor={t.muted}
              />
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.fieldLabel}>Instructor</Text>
              <TextInput
                style={styles.input}
                value={instructor}
                onChangeText={setInstructor}
                placeholder="Prof. Dela Cruz"
                placeholderTextColor={t.muted}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Text style={styles.fieldLabel}>Units</Text>
              <TextInput
                style={styles.input}
                value={units}
                onChangeText={setUnits}
                placeholder="3"
                placeholderTextColor={t.muted}
                keyboardType="decimal-pad"
                accessibilityLabel="Units"
              />
            </View>
            <View style={styles.rowItem} />
          </View>

          <ColorPicker value={color} onChange={setColor} label="Label color" />

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
                <TimeField
                  label="Start"
                  value={m.start}
                  onChange={(v) => patchMeeting(i, { start: v })}
                />
                <TimeField
                  label="End"
                  value={m.end}
                  onChange={(v) => patchMeeting(i, { end: v })}
                />
              </View>

              <Text style={styles.smallLabel}>Room</Text>
              <TextInput
                style={styles.input}
                value={m.room}
                onChangeText={(t) => patchMeeting(i, { room: t })}
                placeholder="CS Laboratory 2"
                placeholderTextColor={t.muted}
              />
            </View>
          ))}
        </ScrollView>

        {formError ? (
          <Text style={styles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
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
  const { grades } = useGrades();
  const [gradesFor, setGradesFor] = useState<Course | null>(null);
  // Keep the open grade book in sync with edits (e.g. units).
  const gradesCourse = gradesFor ? courses.find((c) => c.id === gradesFor.id) ?? null : null;
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
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
  // AlertDialog instead of Alert.alert, which does nothing on web.
  const [removing, setRemoving] = useState<Course | null>(null);
  const confirmRemove = (course: Course) => setRemoving(course);

  // Sharing: ?course=<code> (from a share link) opens "Add a shared course".
  const [sharing, setSharing] = useState<Course | null>(null);
  const [addShared, setAddShared] = useState<{ code?: string } | null>(null);
  const params = useLocalSearchParams<{ course?: string }>();
  useEffect(() => {
    if (params.course && isSupabaseConfigured) {
      setAddShared({ code: String(params.course).slice(0, 16) });
      // Deferred: on a cold load from a share link the root navigator isn't mounted yet.
      setTimeout(() => router.setParams({ course: undefined }), 0);
    }
  }, [params.course]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="Courses"
          subtitle="The classes you're enrolled in. Schedule and Calendar read from this list."
          right={
            isSupabaseConfigured ? (
              <Button variant="ghost" size="sm" onPress={() => setAddShared({})}>
                <UiText className="text-muted-foreground">Add shared course</UiText>
              </Button>
            ) : undefined
          }
        />

        {sorted.length ? <GwaSummary courses={sorted} grades={grades} /> : null}

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

                <Text style={styles.gradeLine}>
                  {(() => {
                    const st = courseStanding(grades[course.id]);
                    const units = `${course.units ?? DEFAULT_UNITS} units`;
                    if (st.isFinal) return `Final grade ${formatGrade(st.grade!)} · ${units}`;
                    if (st.percent == null) return `No scores yet · ${units}`;
                    return `Standing ${st.percent.toFixed(1)}% · est. ${formatGrade(st.estimatedGrade!)} · ${units}`;
                  })()}
                </Text>

                <View style={styles.cardActions}>
                  <Pressable onPress={() => setGradesFor(course)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${course.code} grades`}>
                    <Text style={styles.actionEdit}>Grades</Text>
                  </Pressable>
                  {isSupabaseConfigured ? (
                    <Pressable onPress={() => setSharing(course)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Share ${course.code}`}>
                      <Text style={styles.actionEdit}>Share</Text>
                    </Pressable>
                  ) : null}
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

      <GradesDialog course={gradesCourse} onClose={() => setGradesFor(null)} />
      {isSupabaseConfigured ? (
        <>
          <ShareCourseDialog course={sharing} onClose={() => setSharing(null)} />
          <AddSharedCourseDialog open={!!addShared} initialCode={addShared?.code} onClose={() => setAddShared(null)} />
        </>
      ) : null}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove course?"
        description={`Remove ${removing?.code ?? "this course"}? Its notes canvas is deleted and its tasks are kept without a course.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) removeCourse(removing.id);
          setRemoving(null);
        }}
      />
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  formError: { color: t.danger, fontSize: 13, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  gradeLine: { fontSize: 13, color: t.muted, marginTop: spacing.xs },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 120,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 24, fontWeight: "700", color: t.text },
  subtitle: {
    fontSize: 13,
    color: t.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },

  emptyCard: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: { fontSize: 15, fontWeight: "600", color: t.text },
  emptyHint: { fontSize: 13, color: t.muted, marginTop: spacing.xs },

  courseCard: {
    flexDirection: "row",
    backgroundColor: t.surface,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  colorBar: { width: 6 },
  courseBody: { flex: 1, padding: spacing.md },
  courseCode: { fontSize: 16, fontWeight: "700", color: t.text },
  courseTitle: { fontSize: 14, color: t.text, marginTop: 2 },
  courseMeta: { fontSize: 13, color: t.muted, marginTop: 2 },
  courseMeeting: { fontSize: 13, color: t.muted, marginTop: spacing.xs },
  cardActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  actionEdit: { fontSize: 13, fontWeight: "700", color: t.accent },
  actionRemove: { fontSize: 13, fontWeight: "700", color: t.danger },

  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: t.accent,
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
    backgroundColor: t.bg,
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
  modalTitle: { fontSize: 18, fontWeight: "700", color: t.text },
  modalClose: { fontSize: 18, color: t.muted },
  modalScroll: { paddingHorizontal: spacing.lg },
  modalScrollContent: { paddingBottom: spacing.lg },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: t.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  smallLabel: {
    fontSize: 12,
    color: t.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
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
  row: { flexDirection: "row", gap: spacing.sm },
  rowItem: { flex: 1 },
  timeRow: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  timeInput: { flex: 1, minWidth: 0 },
  periodToggle: {
    flexDirection: "row",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: t.border,
    overflow: "hidden",
  },
  periodBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 2, backgroundColor: t.surface },
  periodBtnOn: { backgroundColor: t.accent },
  periodText: { fontSize: 12, fontWeight: "700", color: t.text },
  periodTextOn: { color: "#FFFFFF" },

  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xs },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  swatchSelected: { borderColor: t.text },
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
  addMeeting: { fontSize: 13, fontWeight: "700", color: t.accent, marginTop: spacing.md },
  meetingCard: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  meetingRemove: { alignSelf: "flex-end" },
  meetingRemoveText: { fontSize: 12, fontWeight: "700", color: t.danger },
  dayChipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  dayChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
  },
  dayChipOn: { backgroundColor: t.accent, borderColor: t.accent },
  dayChipText: { fontSize: 13, fontWeight: "600", color: t.text },
  dayChipTextOn: { color: "#FFFFFF" },

  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  button: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radius.sm, alignItems: "center" },
  buttonSecondary: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  buttonSecondaryText: { color: t.text, fontWeight: "700" },
  buttonPrimary: { backgroundColor: t.accent },
  buttonPrimaryText: { color: "#FFFFFF", fontWeight: "700" },
});
