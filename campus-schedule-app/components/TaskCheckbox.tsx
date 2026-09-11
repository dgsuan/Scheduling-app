import { useEffect, useRef } from "react";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// shadcn Checkbox with a small squash-and-spring when it's ticked.

export function TaskCheckbox({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  const scale = useSharedValue(1);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!checked) return;
    scale.value = withSequence(
      withTiming(0.8, { duration: 70, reduceMotion: ReduceMotion.System }),
      withSpring(1, { damping: 9, stiffness: 320, reduceMotion: ReduceMotion.System })
    );
  }, [checked, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        accessibilityLabel={label}
        className={cn("size-5 rounded-md", className)}
      />
    </Animated.View>
  );
}
