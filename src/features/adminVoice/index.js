/**
 * adminVoice — the /admin/voice TTS control room.
 *
 * Front door is EMPTY by design: the page is route-mounted lazily and nothing
 * else imports it. Exporting it here would pull its chunk into every consumer
 * of this feature, which is the cost architecture.md §14.7 is about.
 */
export {}
