import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Platform } from "react-native";
import chevronRightSvg from "@/assets/icons/chevron-right.svg";
import closeSvg from "@/assets/icons/close.svg";
import languageSvg from "@/assets/icons/language.svg";
import lockSvg from "@/assets/icons/lock.svg";
import playbackSvg from "@/assets/icons/playback.svg";
import back10Svg from "@/assets/icons/player-back10.svg";
import episodesSvg from "@/assets/icons/player-episodes.svg";
import forward10Svg from "@/assets/icons/player-forward10.svg";
import nextSvg from "@/assets/icons/player-next.svg";
import pauseSvg from "@/assets/icons/player-pause.svg";
import pipSvg from "@/assets/icons/player-pip.svg";
import playSvg from "@/assets/icons/player-play.svg";
import searchSvg from "@/assets/icons/search.svg";
import accountSvg from "@/assets/icons/tab-account.svg";
import browseSvg from "@/assets/icons/tab-browse.svg";
import homeSvg from "@/assets/icons/tab-home.svg";
import settingsSvg from "@/assets/icons/tab-settings.svg";

// The app's icon set, with ZERO icon dependencies (#245: no @expo/vector-icons):
// SF Symbols through expo-symbols on iOS — the system's own glyphs, so the tab
// bar reads native — and a small set of white SVGs through expo-image
// everywhere else, recoloured with `tintColor`. A new icon is a row here plus
// one file under assets/icons/. The second group is the landscape player's
// glass chrome (#375, board E «Стекло»); its SVGs are the board's own glyphs.
export type IconName =
  | "home"
  | "browse"
  | "account"
  | "settings"
  | "search"
  | "language"
  | "playback"
  | "play"
  | "pause"
  | "back10"
  | "forward10"
  | "next"
  | "episodes"
  | "pip"
  | "lock"
  | "close"
  | "chevronRight";

const ICONS: Record<IconName, { symbol: SFSymbol; svg: number }> = {
  home: { symbol: "house.fill", svg: homeSvg },
  browse: { symbol: "square.grid.2x2.fill", svg: browseSvg },
  account: { symbol: "person.crop.circle.fill", svg: accountSvg },
  settings: { symbol: "gearshape.fill", svg: settingsSvg },
  search: { symbol: "magnifyingglass", svg: searchSvg },
  language: { symbol: "globe", svg: languageSvg },
  playback: { symbol: "play.rectangle.fill", svg: playbackSvg },
  play: { symbol: "play.fill", svg: playSvg },
  pause: { symbol: "pause.fill", svg: pauseSvg },
  back10: { symbol: "gobackward.10", svg: back10Svg },
  forward10: { symbol: "goforward.10", svg: forward10Svg },
  next: { symbol: "forward.end.fill", svg: nextSvg },
  episodes: { symbol: "rectangle.stack.fill", svg: episodesSvg },
  pip: { symbol: "pip.enter", svg: pipSvg },
  lock: { symbol: "lock.fill", svg: lockSvg },
  close: { symbol: "xmark", svg: closeSvg },
  chevronRight: { symbol: "chevron.right", svg: chevronRightSvg },
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
