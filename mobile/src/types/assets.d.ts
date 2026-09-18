// Metro serves an imported asset (anything in resolver.assetExts — `svg` is
// in Metro's default list) as an asset-registry id, i.e. a number, which is
// exactly what expo-image's `source` accepts. `expo/types` declares CSS
// modules but no `*.svg`, so the tab-bar icons under assets/icons/ need this
// one line to type-check.
declare module "*.svg" {
  const asset: number;
  export default asset;
}
