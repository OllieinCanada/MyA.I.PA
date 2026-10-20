# Pages static asset retention

`npm run build:pages` retains the current generated static assets and two previous
distinct build generations. Identical rebuilds do not age out the previous build.
CSS, JavaScript, maps and lazy-loaded assets are retained together, while unrelated
audio, transcripts and documents are untouched. The verified CI artifact importer
uses the same retention logic. `static-asset-history.json` must travel with the build.

Run `npm run test:pages-static-retention` to exercise adoption of the first old
build, repeated builds, bounded pruning, CI artifact imports and invalid-history
guards. These checks use temporary directories, not production assets.

`npm run test:pages-static-retention:browser` simulates four deployments in a local
browser. It checks saved pages, CSS, JavaScript and lazy-loaded features after
updates, then proves only the oldest generation is pruned. CI retains its report.

This is bounded protection for older open tabs, not indefinite compatibility.
After three distinct deployments, a very old tab may still need a refresh. Files
already removed by earlier deployments are not automatically restored. Retention
does not by itself resolve a historical incident: first verify the current asset
responses and rendered page, then acknowledge only the exact historical alert.
