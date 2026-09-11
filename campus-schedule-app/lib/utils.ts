import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merges Tailwind class names, letting later classes override earlier ones.
// Used by the components in components/ui (React Native Reusables).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
