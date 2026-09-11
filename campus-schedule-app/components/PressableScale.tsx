import { useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { cn } from "@/lib/utils";

// A Pressable that dips slightly while pressed. On web the dip (and any
// hover styles passed via className) ease in with a short CSS transition.
// Pressed state is tracked here rather than via a style function, because
// NativeWind drops function styles when a className is also present.

type Props = Omit<PressableProps, "style"> & {
  className?: string;
  pressedScale?: number;
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({
  style,
  className,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  ...props
}: Props) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...props}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      className={cn("web:transition-all web:duration-150", className)}
      style={[style, pressed && { transform: [{ scale: pressedScale }] }]}
    />
  );
}
