import { CheckCircle2, Smartphone } from "lucide-react-native";
import { Platform, View } from "react-native";

import { SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useInstallPrompt } from "@/lib/pwa";

// "Install as an app" for the web version.

export function InstallSection() {
  const install = useInstallPrompt();
  if (Platform.OS !== "web") return null;

  const hint = install.installed
    ? "You're using the installed app."
    : install.canPrompt
      ? "Opens in its own window, works offline, and stays one tap away."
      : install.ios
        ? "In Safari, tap the Share button, then “Add to Home Screen”."
        : "Use your browser's menu → “Install app” or “Add to Home screen”.";

  return (
    <SettingsSection title="Install" description="Use Campus Schedule like a regular app on your phone or laptop.">
      <SettingsRow label="Install as an app" hint={hint} last>
        {install.installed ? (
          <View className="flex-row items-center gap-1.5">
            <Icon as={CheckCircle2} size={16} className="text-success" />
            <Text className="text-sm font-medium">Installed</Text>
          </View>
        ) : install.canPrompt ? (
          <Button size="sm" onPress={install.prompt}>
            <Icon as={Smartphone} size={14} className="text-primary-foreground" />
            <Text>Install app</Text>
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
