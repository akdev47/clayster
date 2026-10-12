// Lists the font choices used by both the UI dropdown and the text pipeline.
// The font files are Django static files next to the js/ folder, so each URL
// is built from this module's own location and works in the browser and Node.
const fontUrl = (file) =>
  new URL(`../../fonts/${file}`, import.meta.url).href;
const notoSansRegular = fontUrl("NotoSans-Regular.ttf");
const notoSansBold = fontUrl("NotoSans-Bold.ttf");
const notoSerifRegular = fontUrl("NotoSerif-Regular.ttf");
const notoSerifBold = fontUrl("NotoSerif-Bold.ttf");

// Subset to Latin, which is why four faces cost under 200 KB. Anything beyond
// these is covered by uploading a .ttf or .otf.
export const BUILT_IN_FONTS = [
  { id: "sans-regular", label: "Noto Sans", url: notoSansRegular },
  { id: "sans-bold", label: "Noto Sans Bold", url: notoSansBold },
  { id: "serif-regular", label: "Noto Serif", url: notoSerifRegular },
  { id: "serif-bold", label: "Noto Serif Bold", url: notoSerifBold },
];

export const DEFAULT_FONT_ID = "sans-bold";
