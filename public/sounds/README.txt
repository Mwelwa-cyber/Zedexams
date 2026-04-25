Drop short, soft MP3 or WAV files into this folder using these exact
filenames so the results / study-path sound effects pick them up:

  result-success.mp3      played when the learner reaches the quiz / exam
                          results page with a passing score (>= 50%)
  soft-click.mp3          played on action buttons (Try again, More quizzes,
                          Practice weak areas, View corrections, etc.)
  low-score-warning.mp3   played when the learner's score is below 50%

Guidelines:
  - Keep each file < 30 KB if possible. Definitely < 100 KB.
  - Mono, 22-44 kHz, < 1 second.
  - Soft / gentle. Default volume is already capped (0.18 - 0.35).

If any file is missing the helper falls back to a tiny synthesised tone
generated with the Web Audio API, so the page still works fine.

The mute preference is stored in localStorage under the key
"zedexams_sfx_muted" (default: sound ON).
