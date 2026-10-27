import { router } from "expo-router";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// Metro selects StickyBoard.web.tsx for installed web apps, including phones.
export function StickyBoard() {
  return (
    <View className="bg-background flex-1 justify-center gap-4 p-6">
      <Text className="text-2xl font-semibold">Sticky view</Text>
      <Text>Floating sticky windows are available in the web app on supported desktop browsers. Your notes are available here in Notes.</Text>
      <Button onPress={() => router.replace("/notes")}><Text>Open Notes</Text></Button>
    </View>
  );
}
