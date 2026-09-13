import { Plus, X } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { TaskCheckbox } from "@/components/TaskCheckbox";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "@/context/theme";
import { uid, useTasks, type Task } from "@/context/store";
import { cn } from "@/lib/utils";

// Steps inside a task. Ticking the last step completes the task (and
// unticking a step reopens it) — see store.setSubtaskDone.

export function SubtaskList({ task }: { task: Task }) {
  const { updateTask, setSubtaskDone } = useTasks();
  const t = useTheme();
  const [draft, setDraft] = useState("");
  const subtasks = task.subtasks ?? [];

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    updateTask(task.id, { subtasks: [...subtasks, { id: uid("sub"), text, done: false }] });
    setDraft("");
  };

  return (
    <View className="gap-0.5 pb-1 pl-9 pr-2" accessibilityLabel={`Steps for ${task.title || "task"}`}>
      {subtasks.map((s) => (
        <View key={s.id} className="group flex-row items-center gap-2.5 py-1">
          <TaskCheckbox checked={s.done} onCheckedChange={(done) => setSubtaskDone(task.id, s.id, done)} label={s.text || "Step"} className="size-4" />
          <TextInput
            value={s.text}
            onChangeText={(text) => updateTask(task.id, { subtasks: subtasks.map((x) => (x.id === s.id ? { ...x, text } : x)) })}
            accessibilityLabel="Step"
            placeholderTextColor={t.muted}
            className={cn("text-foreground flex-1 p-0 text-sm web:outline-none", s.done && "text-muted-foreground line-through")}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 web:opacity-0 web:group-hover:opacity-100 web:focus-visible:opacity-100"
            onPress={() => updateTask(task.id, { subtasks: subtasks.filter((x) => x.id !== s.id) })}
            accessibilityLabel={`Remove step ${s.text}`}
          >
            <Icon as={X} size={13} className="text-muted-foreground" />
          </Button>
        </View>
      ))}
      <View className="flex-row items-center gap-2.5 py-1">
        <Icon as={Plus} size={14} className="text-muted-foreground ml-0.5" />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          blurOnSubmit={false}
          returnKeyType="done"
          placeholder="Add a step"
          placeholderTextColor={t.muted}
          accessibilityLabel={`Add a step to ${task.title || "task"}`}
          className="text-foreground flex-1 p-0 text-sm web:outline-none"
        />
      </View>
    </View>
  );
}
