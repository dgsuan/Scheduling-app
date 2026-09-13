import { X } from "lucide-react-native";
import { Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import type { ImageLightboxProps } from "@/components/ImageLightbox.types";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

// Native image viewer: full screen, pinch to zoom (iOS ScrollView zoom),
// tap × or the system back gesture to close. Editing lives in the web
// build (ImageLightbox.web.tsx), where the app is actually deployed.

export type { ImageLightboxProps } from "@/components/ImageLightbox.types";

export function ImageLightbox({ uri, width, height, title, onClose }: ImageLightboxProps) {
  const win = useWindowDimensions();
  const ratio = width && height ? height / width : 0.75;
  const w = win.width;
  const h = Math.min(win.height * 0.85, w * ratio);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/90">
        <View className="flex-row items-center justify-between px-4 pb-2 pt-12">
          <Text className="flex-1 text-sm text-white/80" numberOfLines={1}>
            {title ?? "Image"}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close image" hitSlop={12} className="p-2">
            <Icon as={X} size={22} className="text-white" />
          </Pressable>
        </View>
        <ScrollView
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="contain" accessibilityLabel={title ?? "Image"} />
        </ScrollView>
      </View>
    </Modal>
  );
}
