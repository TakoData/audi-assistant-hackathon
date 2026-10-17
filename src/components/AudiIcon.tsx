import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";

// One consistent outline family for the prototype's MMI-style controls.
// These are not Audi's proprietary production icon assets.
export function AudiIcon({ name, size = 23, color = "#F5F3F5" }: {
  name: ComponentProps<typeof Feather>["name"];
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
