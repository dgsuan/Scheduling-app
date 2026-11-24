import { useState } from "react";
import { View } from "react-native";
import { requestPinWidget } from "react-native-android-widget";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SettingsRow } from "./SettingsSection";
export function AndroidWidgetRow() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <SettingsRow label="Habits on your home screen" hint="See today's progress. Tap a habit to check in or start studying.">
    <View className="gap-2"><Button variant="outline" disabled={busy} onPress={async () => {
      setBusy(true);
      try { const accepted = await requestPinWidget({ widgetName: "IskedHabits" }); setMessage(accepted ? "Confirm Add in the Android prompt." : "Long-press your home screen, choose Widgets, then Isked habits."); }
      catch { setMessage("Long-press your home screen, choose Widgets, then Isked habits."); }
      finally { setBusy(false); }
    }}><Text>Add habit widget</Text></Button>{!!message && <Text className="text-muted-foreground text-xs">{message}</Text>}</View>
  </SettingsRow>;
}
