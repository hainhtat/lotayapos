# Myanmar administrative hierarchy source

The repository does not bundle an unverified or hand-written place list. Import data through `POST /api/v1/master-data/locations/import` from the Myanmar Information Management Unit (MIMU) Pcodes dataset.

- Source catalogue: https://themimu.info/place-codes
- Intended release: MIMU Pcodes 9.7 (January 2026), or a later explicitly reviewed release.
- Required levels: State/Region, District, Township, with English and Myanmar names and stable Pcodes.
- Provenance: MIMU states that place names originate from the General Administration Department and field sources, with transliteration by MIMU.

The importer requires the caller to record `source` and `version`. Township delivery fees and operational zones are company configuration and are intentionally not sourced from MIMU.
