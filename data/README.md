# Local timeline data

This directory owns the application's six complete test datasets. `client/data/default-dataset.json` has been removed; build, fixtures and server seeding use `data/default-dataset.json`.

- `catalog.json`: dataset identities, original/generated paths, YAML profiles, screenshot references and authored display presets.
- `<id>.json`: normalized, validated runtime JSON snapshots. Do not hand-edit generated records.
- `original/<id>.json`: exact copies of supplied sources, including files whose `.json` extension actually contains event markup. The converter never writes these files.
- `reports/<id>.json`: source SHA-256, input/output counts, uncertainties, missing assets and date-review findings.
- `jfk.png`, `monet.png`, `religions.png`: supplied comparison images, not runtime event textures.

Regenerate with `.venv/Scripts/python.exe scripts/normalize-test-data.py`, verify with `--check`, then run `npm run build`. Edit catalog display settings or the explicit converter mapping when changing a preset. Keep ambiguous historical dates unchanged unless a correction is supported and documented.

The default operations snapshot contains 1,008 records. Its original 48 records
and opening September 12, 2026 view are unchanged. The deterministic
`operations-expansion-v1` recipe adds 16 records per day on the 30 days before
and after that date: shifts, nested activities, checkpoints and milestones.
The report distinguishes the 48 preserved inputs from the 960 synthetic additions.
Use the calendar to explore August 13 through October 12, 2026.

Only canonical JSON snapshots and already-supported legacy JSON are accepted at runtime. HTML-like historical sources are converted by the offline script, not interpreted by the browser or server. No new database or network data source is introduced.

These are user-provided test sources. Original dataset/image licensing and attribution have not been independently established; do not assume the application's dependency licenses grant redistribution rights to these materials. See [the local data guide](../docs/reference/implementation/local-test-data.md).
