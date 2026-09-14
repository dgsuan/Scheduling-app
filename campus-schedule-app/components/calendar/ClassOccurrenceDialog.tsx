import { Clock, Footprints, MapPin } from "lucide-react-native";
import { View } from "react-native";

import { transferText } from "@/components/schedule/RoomDialog";
import { useCourses, useScheduleRules } from "@/context/store";
import { transferInto } from "@/lib/rooms";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatDayLong } from "@/lib/calendar";
import { formatRange, type DatedOccurrence } from "@/lib/schedule";

// One class on one date: cancel it (just this day) or restore it.

export function ClassOccurrenceDialog({
  occ,
  onClose,
  onCancelClass,
  onRestoreClass,
}: {
  occ: DatedOccurrence | null;
  onClose: () => void;
  onCancelClass: (occ: DatedOccurrence) => void;
  onRestoreClass: (occ: DatedOccurrence) => void;
}) {
  const { courses } = useCourses();
  const rules = useScheduleRules();
  const transfer = occ && occ.status === "scheduled" ? transferInto(courses, occ, rules) : null;
  return (
    <Dialog open={!!occ} onOpenChange={(o) => !o && onClose()}>
      {occ ? (
        <DialogContent className="gap-4 p-5 sm:max-w-sm">
          <DialogHeader>
            <View className="flex-row items-center gap-2">
              <View className="size-2.5 rounded-full" style={{ backgroundColor: occ.course.color }} />
              <DialogTitle>{occ.course.code}</DialogTitle>
            </View>
            <DialogDescription>
              {occ.course.title ? `${occ.course.title} · ` : ""}
              {formatDayLong(occ.date)}
            </DialogDescription>
          </DialogHeader>
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <Icon as={Clock} size={14} className="text-muted-foreground" />
              <Text className="text-sm">{formatRange(occ.meeting.start, occ.meeting.end)}</Text>
            </View>
            {occ.meeting.room ? (
              <View className="flex-row items-center gap-2">
                <Icon as={MapPin} size={14} className="text-muted-foreground" />
                <Text className="text-sm">{occ.meeting.room}</Text>
              </View>
            ) : null}
            {transfer ? (
              <View className="flex-row items-start gap-2">
                <Icon as={Footprints} size={14} className="text-muted-foreground mt-0.5" />
                <Text className="flex-1 text-sm leading-5">{transferText(transfer)}</Text>
              </View>
            ) : null}
            {occ.status === "cancelled" ? (
              <Text className="text-destructive text-sm font-medium">Cancelled for this day.</Text>
            ) : occ.status === "holiday" ? (
              <Text className="text-muted-foreground text-sm">
                No class — {occ.holiday?.name ?? "holiday"}. Holiday skipping can be changed in Settings.
              </Text>
            ) : (
              <Text className="text-muted-foreground text-sm">Cancelling affects only this day; the weekly schedule stays.</Text>
            )}
          </View>
          <DialogFooter>
            <Button variant="outline" size="sm" onPress={onClose}>
              <Text>Close</Text>
            </Button>
            {occ.status === "scheduled" ? (
              <Button
                size="sm"
                variant="destructive"
                onPress={() => {
                  onCancelClass(occ);
                  onClose();
                }}
              >
                <Text>Cancel this class</Text>
              </Button>
            ) : occ.status === "cancelled" ? (
              <Button
                size="sm"
                onPress={() => {
                  onRestoreClass(occ);
                  onClose();
                }}
              >
                <Text>Restore class</Text>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
