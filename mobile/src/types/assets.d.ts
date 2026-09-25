// Metro serves an imported asset (anything in resolver.assetExts — `svg` and
// `png` are in Metro's default list) as an asset-registry id, i.e. a number,
// which is exactly what expo-image's `source` accepts. `expo/types` declares
// CSS modules but neither of these, so the tab-bar icons under assets/icons/
// and the Home wordmark (a png with @2x/@3x siblings Metro picks per screen)
// need these lines to type-check.
declare module "*.svg" {
  const asset: number;
  export default asset;
}

declare module "*.png" {
  const asset: number;
  export default asset;
}
