# OpenBEXI Timeline 2.0

A timeline for events and sessions, with a JavaScript/Three.js client, Python
server, JSON data and a standalone edition.

The current direction is to simplify the application around the legacy interface
and YAML-selected model/filter/data files. Version-2 environments, dynamic grouping
and the compact toolbar are implemented. See the
[saved prompt](openbexi_timeline2.0_current_prompt.md).

## Quick start

Install Python 3.9+ from the supported set and Node 22+, then run from this checkout:

```powershell
python scripts/start.py
```

The launcher prepares the locked dependencies, builds the client and starts the
bundled default dataset. It does not require a global `uv` command. Use `py -3`
on Windows or `python3` on macOS/Linux if necessary. First setup needs network
access to package registries.

For legacy validation with SOURCE1 and SOURCE2:

```powershell
python scripts/start.py -- --yaml yaml/default_test.yml
```

Open the printed URL. This profile requires the adjacent legacy checkout and its
`tests/data/SOURCES1` and `tests/data/SOURCES2` folders. For IntelliJ,
dependency setup, other operating modes and troubleshooting, see
[deployment](docs/openbexi_timeline2.0_deployment.md).

## Live demos

Open any bundled dataset directly in the browser. Each demo includes the complete
standalone application; use the calendar or drag the timeline to explore other dates.
The default dataset contains 1,008 records from August 13 to October 12, 2026,
including daily shifts, nested activities and events before and after the original sample day.

| Dataset | Live demo |
| --- | --- |
| Default operations | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=default-dataset) |
| Ephemeris | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=ephemeris) |
| John F. Kennedy | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=jfk) |
| Claude Monet | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=monet) |
| Religions | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=religions) |
| Space exploration | [Open timeline](https://arcazj.github.io/openbexi_timeline2.0/?dataset=space_exploration) |
| multiple_sources_test | [Open SOURCE1 / SOURCE2 preview](https://arcazj.github.io/openbexi_timeline2.0/?dataset=multiple_sources_test) |

The same datasets are available under **Help → Test local dataset**. Changes stay
in your browser session until you export them. Original historical fixtures and
conversion reports are preserved in [data](data/README.md).

`multiple_sources_test` opens 1,145 records from the March 17 SOURCE2 and March 24
SOURCE1 event files, with their original dates and available descriptor notes.
Its opening range spans March 17–25, 2024 so both sources are included. This is a
bounded browser preview; the complete copied 2024 archives are under
`data/SOURCES1/2024` and `data/SOURCES2/2024`.
To browse the full archives with the same model and filter, run:

```powershell
python scripts/start.py -- --yaml yaml/multiple_sources_test.yml
```

## Documentation

- [User manual and legacy toolbar](docs/openbexi_timeline2.0_user_manual.md)

- [Prompt history and decisions](docs/openbexi_timeline2.0_prompt_history.md)
- [Design and user workflows](docs/openbexi_timeline2.0_design.md)
- [Data and configuration design](docs/openbexi_timeline2.0_data_design.md)
- [Architecture and legacy REST compatibility](docs/openbexi_timeline2.0_architecture.md)
- [Tests and acceptance](docs/openbexi_timeline2.0_tests.md)
- [Setup and deployment](docs/openbexi_timeline2.0_deployment.md)

## Testing

Follow the [test commands and evidence boundaries](docs/openbexi_timeline2.0_tests.md).
The launcher accepts version-1 and version-2 profiles; new environments use
filter-owned opening ranges and explicit model/filter files.
The [documentation index](docs/README.md) also links to retained implementation
references, licenses and verification evidence.

## Contributing and licensing

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [LICENSE](LICENSE)
and [NOTICE](NOTICE). Third-party assets and datasets retain their own
[notices](docs/third-party-notices.md) and [provenance](docs/data-licensing.md).
[Release records](docs/release-history.md) and [version 2.0 notes](docs/releases/v2.0.0.md)
describe the published changes and validation.
