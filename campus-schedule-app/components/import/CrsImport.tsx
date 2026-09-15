import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { ClipboardPaste, FileText, TriangleAlert } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { meetingLine } from "@/components/courses/CourseSharing";
import { useToast } from "@/components/Toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { colors } from "@/constants/theme";
import { useCourses } from "@/context/store";
import { parseCrs, planCrsImport, type CrsParseResult } from "@/lib/crs";
import { extractPdfText } from "@/lib/pdfText";
import { cn } from "@/lib/utils";

// Paste the class table from UP CRS (enlisted classes / Form 5), or upload
// the Form 5 PDF, and turn it into courses. Everything is read on this
// device; nothing is uploaded.

const MAX_PASTE = 20_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function CrsImport() {
  const { courses, addCourse, updateCourse } = useCourses();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CrsParseResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);

  const rows = useMemo(() => (result ? planCrsImport(result.courses, courses) : []), [result, courses]);
  const selected = rows.filter((r, i) => r.status !== "same" && !excluded.has(i));

  const read = (value = text) => {
    setResult(parseCrs(value.slice(0, MAX_PASTE)));
    setExcluded(new Set());
  };

  const uploadPdf = async () => {
    setPdfError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.size && asset.size > MAX_PDF_BYTES) {
      setPdfError("That PDF is over 10 MB. Form 5 PDFs are usually much smaller — check it's the right file.");
      return;
    }
    setPdfBusy(true);
    try {
      const data = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
      const extracted = (await extractPdfText(data)).slice(0, MAX_PASTE);
      if (!extracted.trim()) {
        throw new Error("This PDF has no readable text — it may be a scanned image. Copy the table from CRS and paste it instead.");
      }
      setText(extracted);
      setPdfName(asset.name);
      read(extracted);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  const apply = () => {
    let added = 0;
    let updated = 0;
    selected.forEach((row, i) => {
      const p = row.parsed;
      if (row.match) {
        updateCourse(row.match.id, {
          meetings: p.meetings,
          units: p.units ?? row.match.units,
          title: row.match.title ?? p.title,
        });
        updated++;
      } else {
        addCourse({
          code: p.code,
          section: p.section,
          title: p.title,
          units: p.units,
          meetings: p.meetings,
          color: colors.courseColors[(courses.length + i) % colors.courseColors.length],
        });
        added++;
      }
    });
    toast({
      message: [added && `Added ${added} course${added === 1 ? "" : "s"}`, updated && `updated ${updated}`].filter(Boolean).join(", "),
      actionLabel: "View courses",
      onAction: () => router.navigate("/courses"),
    });
    setResult(null);
    setText("");
    setPdfName(null);
  };

  return (
    <View className="bg-card/80 border-border mb-6 rounded-xl border">
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <Icon as={ClipboardPaste} size={16} className="text-primary" />
          <Text className="text-[15px] font-semibold">Add your classes from CRS</Text>
        </View>
        <Text className="text-muted-foreground text-sm leading-5">
          Upload your Form 5 PDF, or open your enlisted classes in CRS, copy the whole table, and paste it here. It&apos;s read on this
          device — nothing is uploaded.
        </Text>
        <Textarea
          value={text}
          onChangeText={(t) => {
            setText(t.slice(0, MAX_PASTE));
            if (result) setResult(null);
          }}
          placeholder={"54321   CMSC 21 T-3L   3.0   TTh 10-11:30AM lec AECH; F 1-4PM lab TL3"}
          numberOfLines={5}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Pasted CRS schedule"
          className="min-h-28 font-mono text-[13px]"
        />
        <View className="flex-row flex-wrap gap-2">
          <Button onPress={() => read()} disabled={!text.trim()}>
            <Text>Read schedule</Text>
          </Button>
          {Platform.OS === "web" ? (
            <Button variant="outline" onPress={uploadPdf} disabled={pdfBusy}>
              <Icon as={FileText} size={15} className="text-foreground" />
              <Text>{pdfBusy ? "Reading PDF…" : "Upload Form 5 (PDF)"}</Text>
            </Button>
          ) : null}
          {text ? (
            <Button
              variant="ghost"
              onPress={() => {
                setText("");
                setResult(null);
                setPdfName(null);
                setPdfError(null);
              }}
            >
              <Text>Clear</Text>
            </Button>
          ) : null}
        </View>
        {pdfName && result ? (
          <Text className="text-muted-foreground text-xs leading-4">
            Read from {pdfName}. The text is in the box above — fix anything that didn&apos;t come out right, then press Read schedule again.
          </Text>
        ) : null}
        {pdfError ? (
          <View className="border-destructive/40 bg-destructive/10 flex-row gap-2.5 rounded-lg border p-3" role="alert">
            <Icon as={TriangleAlert} size={16} className="text-destructive mt-0.5" />
            <Text className="flex-1 text-sm leading-5">{pdfError}</Text>
          </View>
        ) : null}
      </View>

      {result ? (
        <View className="border-border/70 gap-3 border-t p-4">
          {rows.length === 0 ? (
            <View className="border-destructive/40 bg-destructive/10 flex-row gap-2.5 rounded-lg border p-3" role="alert">
              <Icon as={TriangleAlert} size={16} className="text-destructive mt-0.5" />
              <Text className="flex-1 text-sm leading-5">
                No classes found. Copy the whole table from CRS, including the Class and Schedule columns (e.g. “CMSC 21 T-3L … TTh
                10-11:30AM”).
              </Text>
            </View>
          ) : (
            <>
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="text-sm">
                  Found {rows.length} class{rows.length === 1 ? "" : "es"}
                </Text>
                <Button onPress={apply} disabled={!selected.length}>
                  <Text>{selected.length ? `Add ${selected.length} to Courses` : "Nothing new"}</Text>
                </Button>
              </View>
              <View className="border-border rounded-lg border">
                {rows.map((row, i) => {
                  const same = row.status === "same";
                  const on = !same && !excluded.has(i);
                  const toggle = () =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    });
                  const p = row.parsed;
                  return (
                    <Pressable
                      key={`${p.code}-${p.section ?? ""}-${i}`}
                      onPress={same ? undefined : toggle}
                      disabled={same}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: same }}
                      accessibilityLabel={`${p.code} ${p.section ?? ""}`}
                      className={cn(
                        "flex-row items-start gap-3 px-3 py-2.5 web:transition-colors",
                        i > 0 && "border-border/60 border-t",
                        !same && "web:hover:bg-accent/40",
                        same && "opacity-60"
                      )}
                    >
                      <View className="pt-0.5" pointerEvents="none">
                        <Checkbox checked={on} onCheckedChange={() => {}} disabled={same} className="size-5 rounded-md" />
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Text className="text-[15px] font-medium">
                          {p.code}
                          {p.section ? ` (${p.section})` : ""}
                          {p.units ? <Text className="text-muted-foreground text-[13px] font-normal">{`  ${p.units} units`}</Text> : null}
                        </Text>
                        {p.title ? <Text className="text-muted-foreground text-[13px]">{p.title}</Text> : null}
                        {p.meetings.length ? (
                          p.meetings.map((m, j) => (
                            <Text key={j} className="text-muted-foreground text-[13px] tabular-nums">
                              {meetingLine(m)}
                            </Text>
                          ))
                        ) : (
                          <Text className="text-muted-foreground text-[13px]">No meeting times</Text>
                        )}
                      </View>
                      <Badge variant="outline">
                        <Text>{row.status === "new" ? "New" : row.status === "update" ? "Updates times" : "Already added"}</Text>
                      </Badge>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {result.warnings.length ? (
            <View className="border-warning/40 bg-warning/10 gap-1 rounded-lg border px-3 py-2">
              {result.warnings.slice(0, 6).map((w, i) => (
                <Text key={i} className="text-sm leading-5">
                  {w}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
