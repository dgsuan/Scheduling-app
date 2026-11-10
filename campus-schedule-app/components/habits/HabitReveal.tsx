import { createContext, useContext, useRef, type ComponentProps } from "react";
import { View } from "react-native";

export const HabitRevealContext = createContext<(target: View) => void>(() => {});

/** Reveal newly mounted controls once, without jumping while the user types. */
export function HabitReveal(props: ComponentProps<typeof View>) {
  const reveal = useContext(HabitRevealContext);
  const ref = useRef<View>(null);
  const shown = useRef(false);
  return <View {...props} ref={ref} onLayout={event => {
    props.onLayout?.(event);
    if (shown.current) return;
    shown.current = true;
    requestAnimationFrame(() => { if (ref.current) reveal(ref.current); });
  }} />;
}
