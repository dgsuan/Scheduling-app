import { Check, RotateCcw, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  FONTS,
  PRESETS,
  RADII,
  UI_SCALES,
  type FontId,
  type PresetId,
  type RadiusId,
  type ThemeMode,
} from "@/constants/theme";
import { useAppearance } from "@/context/theme";
import { hslToHex, isLight, normalizeHex } from "@/lib/color";
import { cn } from "@/lib/utils";

// Appearance settings. Everything writes through setAppearance → tokens,
// so changes apply instantly across the app and persist.

const ACCENTS = ["#28716A", "#3B6FD4", "#5E8A3A", "#9A4A7F", "#C8553D", "#B7791F", "#5A6475"];
const BACKGROUNDS = [
  { label: "Paper", hex: "#F7F4EC" },
  { label: "Mist", hex: "#EEF2F5" },
  { label: "Sage", hex: "#E8EEE4" },
  { label: "Charcoal", hex: "#1C1D21" },
  { label: "Midnight", hex: "#0F1420" },
  { label: "Cocoa", hex: "#221B17" },
];

function Swatch({
  color,
  selected,
  label,
  onPress,
  split,
}: {
  color: string;
  selected: boolean;
  label: string;
  onPress: () => void;
  /** Second color for a diagonal split (light/dark preview). */
  split?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      className="items-center gap-1.5 web:transition-transform web:hover:scale-105 active:scale-95"
    >
      <View
        className={cn("size-9 items-center justify-center overflow-hidden rounded-full border", selected ? "border-foreground border-2" : "border-border")}
        style={{ backgroundColor: color }}
      >
        {split ? (
          <View style={{ position: "absolute", right: -18, bottom: -18, width: 36, height: 36, backgroundColor: split, transform: [{ rotate: "45deg" }] }} />
        ) : null}
        {selected ? <Icon as={Check} size={15} color={isLight(color) ? "#1A1A1A" : "#FFFFFF"} /> : null}
      </View>
    </Pressable>
  );
}

function HexField({ value, onCommit, label }: { value: string | null; onCommit: (hex: string) => void; label: string }) {
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState(false);
  const commit = () => {
    if (!text.trim()) return;
    const hex = normalizeHex(text);
    setError(!hex);
    if (hex) {
      setText(hex);
      onCommit(hex);
    }
  };
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <View className="border-border size-6 rounded-md border" style={{ backgroundColor: normalizeHex(text) ?? "transparent" }} />
        <Input
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (error) setError(false);
          }}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder="#28716A"
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={label}
          className="h-9 w-28 font-mono text-sm"
        />
      </View>
      {error ? <Text className="text-destructive text-xs">Use a hex color like #28716A</Text> : null}
    </View>
  );
}

export function AppearanceSection() {
  const { appearance: a, setAppearance, resetAppearance, theme } = useAppearance();
  const [customAccent, setCustomAccent] = useState(!!a.accent && !ACCENTS.includes(a.accent));
  const [customBg, setCustomBg] = useState(!!a.background && !BACKGROUNDS.some((b) => b.hex === a.background));
  const presetIds = Object.keys(PRESETS) as PresetId[];

  return (
    <SettingsSection title="Appearance" description="Colors, type and size. Changes apply right away and are saved on this device.">
      {/* Live preview */}
      <View className="border-border/70 gap-3 border-b p-4">
        <View className="bg-background border-border gap-2 rounded-xl border p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1.2px]">Preview</Text>
            <Badge variant="secondary">
              <Text>Due soon</Text>
            </Badge>
          </View>
          <Text className="font-display text-2xl font-semibold">CMSC 13 · Programming</Text>
          <Text className="text-muted-foreground text-sm">2:30 PM – 4:00 PM · CS Laboratory 2</Text>
          <View className="mt-1 flex-row gap-2">
            <Button size="sm">
              <Text>Primary</Text>
            </Button>
            <Button size="sm" variant="outline">
              <Text>Secondary</Text>
            </Button>
          </View>
        </View>
        {theme.contrastIssues.length ? (
          <View className="border-warning/50 bg-warning/10 flex-row gap-2.5 rounded-lg border p-3" role="alert">
            <Icon as={TriangleAlert} size={16} className="text-warning mt-0.5" />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold">Some text may be hard to read</Text>
              {theme.contrastIssues.map((i) => (
                <Text key={i.label} className="text-muted-foreground text-xs">
                  {i.label}: contrast {i.ratio.toFixed(1)}:1 (aim for {i.min}:1)
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <SettingsRow label="Theme" hint="A starting point for the colors.">
        <View className="flex-row flex-wrap gap-3" role="radiogroup" aria-label="Theme">
          {presetIds.map((id) => {
            const p = PRESETS[id];
            return (
              <View key={id} className="items-center gap-1">
                <Swatch
                  color={hslToHex(...p.light)}
                  split={hslToHex(...p.dark)}
                  selected={a.preset === id && !a.accent}
                  label={`${p.label} theme`}
                  onPress={() => {
                    setAppearance({ preset: id, accent: null });
                    setCustomAccent(false);
                  }}
                />
                <Text className="text-muted-foreground text-[11px]">{p.label}</Text>
              </View>
            );
          })}
        </View>
      </SettingsRow>

      <SettingsRow
        label="Mode"
        hint={a.background ? "Set by your custom background." : "System follows your device's light/dark setting."}
      >
        <SegmentedControl<ThemeMode>
          value={a.mode}
          onChange={(mode) => setAppearance({ mode, background: null })}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          accessibilityLabel="Color mode"
        />
      </SettingsRow>

      <SettingsRow label="Accent color" hint="Buttons, links, today and the current class." stacked>
        <View className="flex-row flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((hex) => (
            <Swatch
              key={hex}
              color={hex}
              label={`Accent ${hex}`}
              selected={a.accent === hex}
              onPress={() => {
                setAppearance({ accent: hex });
                setCustomAccent(false);
              }}
            />
          ))}
          <Button variant="ghost" size="sm" onPress={() => setCustomAccent((v) => !v)} accessibilityState={{ expanded: customAccent }}>
            <Text>Custom…</Text>
          </Button>
          {a.accent ? (
            <Button variant="ghost" size="sm" onPress={() => setAppearance({ accent: null })}>
              <Text className="text-muted-foreground">Use theme color</Text>
            </Button>
          ) : null}
        </View>
        {customAccent ? <HexField value={a.accent} onCommit={(hex) => setAppearance({ accent: hex })} label="Custom accent color" /> : null}
      </SettingsRow>

      <SettingsRow label="Background" hint="A custom background also decides light or dark." stacked>
        <View className="flex-row flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Background">
          <Pressable
            onPress={() => {
              setAppearance({ background: null });
              setCustomBg(false);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: !a.background }}
            className={cn(
              "h-9 justify-center rounded-full border px-3 web:transition-colors web:hover:bg-accent",
              !a.background ? "border-foreground border-2" : "border-border"
            )}
          >
            <Text className="text-sm">Default</Text>
          </Pressable>
          {BACKGROUNDS.map((b) => (
            <Swatch
              key={b.hex}
              color={b.hex}
              label={`${b.label} background`}
              selected={a.background === b.hex}
              onPress={() => {
                setAppearance({ background: b.hex });
                setCustomBg(false);
              }}
            />
          ))}
          <Button variant="ghost" size="sm" onPress={() => setCustomBg((v) => !v)} accessibilityState={{ expanded: customBg }}>
            <Text>Custom…</Text>
          </Button>
        </View>
        {customBg ? <HexField value={a.background} onCommit={(hex) => setAppearance({ background: hex })} label="Custom background color" /> : null}
      </SettingsRow>

      <SettingsRow label="Font" stacked>
        <View className="flex-row flex-wrap gap-2" role="radiogroup" aria-label="Font">
          {(Object.keys(FONTS) as FontId[]).map((id) => {
            const on = a.font === id;
            return (
              <Pressable
                key={id}
                onPress={() => setAppearance({ font: id })}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                className={cn(
                  "rounded-lg border px-3 py-2 web:transition-colors web:hover:bg-accent",
                  on ? "border-primary bg-primary/10" : "border-border"
                )}
              >
                <Text className={cn("text-sm", on && "font-semibold")}>{FONTS[id].label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SettingsRow>

      <SettingsToggleRow
        label="Serif headings"
        hint="Use the soft serif for page titles and big numbers."
        checked={a.serifHeadings}
        onChange={(serifHeadings) => setAppearance({ serifHeadings })}
      />

      {Platform.OS === "web" ? (
        <SettingsRow label="Interface size" hint="Scales text and controls together.">
          <SegmentedControl<string>
            value={String(a.scale)}
            onChange={(v) => setAppearance({ scale: Number(v) })}
            options={UI_SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))}
            accessibilityLabel="Interface size"
          />
        </SettingsRow>
      ) : null}

      <SettingsRow label="Corners">
        <SegmentedControl<RadiusId>
          value={a.radius}
          onChange={(radius) => setAppearance({ radius })}
          options={(Object.keys(RADII) as RadiusId[]).map((id) => ({ value: id, label: RADII[id].label }))}
          accessibilityLabel="Corner roundness"
        />
      </SettingsRow>

      <SettingsToggleRow
        label="Time-of-day atmosphere"
        hint="Let colors shift gently between morning, evening and night."
        checked={a.atmosphere}
        onChange={(atmosphere) => setAppearance({ atmosphere })}
      />

      <View className="flex-row justify-end px-3 py-2.5">
        <Button variant="ghost" size="sm" onPress={resetAppearance}>
          <Icon as={RotateCcw} size={14} className="text-muted-foreground" />
          <Text className="text-muted-foreground">Reset appearance</Text>
        </Button>
      </View>
    </SettingsSection>
  );
}
