import { router } from "expo-router";

import { SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// Where to find the Guide again after the Home banner is gone.

export function HelpSection() {
  return (
    <SettingsSection title="Help">
      <SettingsRow label="Guide" hint="How everything works, and what's new in this update." last>
        <Button variant="outline" size="sm" onPress={() => router.navigate("/guide")}>
          <Text>Open the guide</Text>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
