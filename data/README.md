# Data

`wingo_transcribed.csv` — 802 real WinGo 1-minute results transcribed from the user's PDF (`Data_Report.pdf`).

Known limitations (read before trusting any statistic):
* **No round IDs or timestamps.** The source spreadsheet had already corrupted IDs to `2.03E+16`. Gaps, duplicates and
  true chronological order cannot be verified. Rows are stored in the order they appeared in the PDF (`seq` 1..802);
  the platform assumes that order is oldest → newest. If your PDF lists the newest round first, re-import with `newest_first`.
* **Hand/vision transcription.** Size and colour were read from the image and cross-checked against the game rule; the digit
  was chosen between the two candidates that rule allows (e.g. green+Small = 1 or 3). A few misreads are possible.
* Replace this file with an export from the official source (period IDs as TEXT, plus timestamps) when you can:
  `python -m app.scripts.import_csv path/to/export.csv`.

Raw imports are stored untouched in `raw_results`; cleaned rows live in `results`.
