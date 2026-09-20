# Local timeline data

This directory owns the application's bundled test datasets and copied source archives. Build, fixtures and server seeding use `data/default-dataset.json`.

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

`SOURCES1/2024` and `SOURCES2/2024` preserve the supplied archives byte for byte:
120,641 and 190 files respectively. They are read through
`yaml/multiple_sources_test.yml`, with the corresponding model and filter under
`models/` and `filters/`. SOURCE2 has data on March 17–18; SOURCE1 begins on
March 23–24 and continues into November. The dates are not shifted to overlap.

The `multiple_sources_test` browser preview contains all 1,145 canonical records
from `SOURCES1/2024/03/24/events.json` and `SOURCES2/2024/03/17/events.json`.
It includes available linked descriptor notes and opens March 17–25, 2024.
The other archive days remain available through the local server; they are not
embedded in the standalone HTML. The normalization report records all preview
input hashes, namespace counts and legacy JSON diagnostics. Regeneration is part
of `scripts/normalize-test-data.py`; source files are never rewritten.

Only canonical JSON snapshots and already-supported legacy JSON are accepted at runtime. HTML-like historical sources are converted by the offline script, not interpreted by the browser or server. No new database or network data source is introduced.

These are user-provided test sources. Original dataset/image licensing and attribution have not been independently established; do not assume the application's dependency licenses grant redistribution rights to these materials. See [the local data guide](../docs/reference/implementation/local-test-data.md).
