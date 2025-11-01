# SheetJS XLSX Vendor Bundle

This directory vendors the standalone SheetJS runtime used for exporting workbooks
to `.xlsx` files within the Sheets frontend.

- Upstream package: `xlsx@0.18.5`
- Source: https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
- Vendored on: 2025-10-31

The script exposes the global `window.XLSX` object; the UI lazily loads it only
when an XLSX export is requested so normal editing does not incur the cost.
