import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Platform } from "react-native";
import accountSvg from "@/assets/icons/tab-account.svg";
import browseSvg from "@/assets/icons/tab-browse.svg";
import homeSvg from "@/assets/icons/tab-home.svg";
import languageSvg from "@/assets/icons/language.svg";
import playbackSvg from "@/assets/icons/playback.svg";
import searchSvg from "@/assets/icons/search.svg";
import settingsSvg from "@/assets/icons/tab-settings.svg";

// The app's icon set, with ZERO icon dependencies (#245: no @expo/vector-icons):
// SF Symbols through expo-symbols on iOS — the system's own glyphs, so the tab
// bar reads native — and a small set of white SVGs through expo-image
// everywhere else, recoloured with `tintColor`. Seven icons is the whole set;
// a new one is a row here plus one file under assets/icons/.
export type IconName =
  | "home"
  | "browse"
  | "account"
  | "settings"
  | "search"
  | "language"
  | "playback";

const ICONS: Record<IconName, { symbol: SFSymbol; svg: number }> = {
  home: { symbol: "house.fill", svg: homeSvg },
  browse: { symbol: "square.grid.2x2.fill", svg: browseSvg },
  account: { symbol: "person.crop.circle.fill", svg: accountSvg },
  settings: { symbol: "gearshape.fill", svg: settingsSvg },
  search: { symbol: "magnifyingglass", svg: searchSvg },
  language: { symbol: "globe", svg: languageSvg },
  playback: { symbol: "play.rectangle.fill", svg: playbackSvg },
};

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) {
  const icon = ICONS[name];
  const box = { width: size, height: size };
  if (Platform.OS === "ios") {
    return (
      <SymbolView name={icon.symbol} size={size} tintColor={color} weight="medium" style={box} />
    );
  }
  return <Image source={icon.svg} style={box} tintColor={color} contentFit="contain" />;
}
