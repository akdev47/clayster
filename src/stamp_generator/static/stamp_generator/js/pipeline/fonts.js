// Lists the font choices used by both the UI dropdown and the text pipeline.
// Vite rewrites these to hashed asset URLs and copies them into the build, so
// the fonts work in dev and in production without a public/ directory.
import notoSansRegular from "../../fonts/NotoSans-Regular.ttf?url";
import notoSansBold from "../../fonts/NotoSans-Bold.ttf?url";
import notoSerifRegular from "../../fonts/NotoSerif-Regular.ttf?url";
import notoSerifBold from "../../fonts/NotoSerif-Bold.ttf?url";

// Subset to Latin, which is why four faces cost under 200 KB. Anything beyond
// these is covered by uploading a .ttf or .otf.
export const BUILT_IN_FONTS = [
  { id: "sans-regular", label: "Noto Sans", url: notoSansRegular },
  { id: "sans-bold", label: "Noto Sans Bold", url: notoSansBold },
  { id: "serif-regular", label: "Noto Serif", url: notoSerifRegular },
  { id: "serif-bold", label: "Noto Serif Bold", url: notoSerifBold },
];

export const DEFAULT_FONT_ID = "sans-bold";
