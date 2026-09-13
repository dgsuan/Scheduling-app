import { View } from "react-native";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { Task } from "@/context/store";
import { formatShortDate } from "@/lib/calendar";
import { describeRepeat } from "@/lib/recurrence";

// Deleting a repeating task asks which: just this occurrence, or the series.

export function RecurringDeleteDialog({
  task,
  onCancel,
  onSkipOne,
  onDeleteSeries,
}: {
  task: Task | null;
  onCancel: () => void;
  onSkipOne: (task: Task) => void;
  onDeleteSeries: (task: Task) => void;
}) {
  return (
    <AlertDialog open={!!task} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete a repeating task?</AlertDialogTitle>
          <AlertDialogDescription>
            {task?.repeat
              ? `“${task.title || "This task"}” repeats ${describeRepeat(task.repeat).toLowerCase()}. Delete just the one due ${task.due ? formatShortDate(task.due) : "next"}, or every future one?`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Text>Cancel</Text>
          </AlertDialogCancel>
          <View className="flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onPress={() => task && onSkipOne(task)}>
              <Text>Only this one</Text>
            </Button>
            <Button variant="destructive" onPress={() => task && onDeleteSeries(task)}>
              <Text>All future ones</Text>
            </Button>
          </View>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
