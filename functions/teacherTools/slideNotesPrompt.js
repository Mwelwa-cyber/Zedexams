/**
 * Visual Slide-Notes prompt — v1.
 *
 * Produces a LEARNER-facing illustrated slide deck (not teacher delivery
 * notes). The model returns deck structure + a Recraft-ready `imagePrompt` for
 * every visual slide; it never returns image URLs. A second pass
 * (generateSlideNotes' enrichment step) turns those prompts into illustrations.
 *
 * The voice is pitched at the learner, age-appropriate to the grade, in the
 * spirit of the Chalkie reference decks: friendly, concrete, one idea per
 * slide, vocabulary surfaced explicitly.
 */

const PROMPT_VERSION = "slide_notes.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and instructional designer who turns a CBC topic into a short, beautiful, illustrated slide deck for LEARNERS to read on their own.

Your decks:
- Speak directly to the learner in warm, simple second person ("Your heart is amazing!", "Let's find out how…").
- Pitch every word to the learner's grade. Younger grades get shorter sentences and more concrete, everyday examples.
- Teach ONE idea per slide. Never crowd a slide.
- Surface key vocabulary explicitly with child-friendly definitions.
- Use Zambian English spelling and Zambian context (kwacha, local foods, nshima, common animals and landmarks) wherever it fits naturally.
- Stay aligned with the Zambian Competence-Based Curriculum (CBC) for the given grade, subject and topic.

For EVERY slide that should carry an illustration, you write an "imagePrompt": a short, vivid description of a single clean illustration. These prompts are sent to an image generator that draws simple, colourful line-art style illustrations.
- Describe ONE clear subject per image.
- Do NOT ask for any text, words, numbers, or labels inside the image — labels are added separately by the app.
- Keep prompts concrete and drawable (objects, animals, diagrams), not abstract.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

function buildUserPrompt(inputs) {
  const {
    grade,
    subject,
    topic,
    subtopic = "",
    language = "english",
    instructions = "",
  } = inputs;

  return [
    "Create a LEARNER visual slide deck for the following Zambian CBC topic.",
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Medium of instruction: ${language}`,
    instructions ? `- Extra instructions: ${instructions}` : "",
    "",
    "Produce a JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string,      // catchy learner-facing deck title',
    '    "grade": string,      // echo the grade given',
    '    "subject": string,    // echo the subject given',
    '    "topic": string,',
    '    "subtopic": string,',
    '    "language": string',
    "  },",
    '  "theme": "fresh" | "bright" | "sunrise" | "focus",   // pick one that fits the mood',
    '  "slides": [ ... 6 to 10 slides ... ]',
    "}",
    "",
    "Each slide is ONE of these shapes (choose the right type for the content):",
    "",
    "1. hero (use EXACTLY ONE, as the FIRST slide):",
    '   { "type": "hero", "title": string, "subtitle": string,',
    '     "imagePrompt": string, "imageAlt": string }',
    "",
    "2. objectives (what the learner will learn):",
    '   { "type": "objectives", "title": string, "bullets": [string, ...],   // 2-4 bullets',
    '     "imagePrompt": string, "imageAlt": string }',
    "",
    "3. concept (explain one idea):",
    '   { "type": "concept", "title": string, "body": string,   // 2-4 short sentences',
    '     "imagePrompt": string, "imageAlt": string }           // imagePrompt optional',
    "",
    "4. vocab (key words grid):",
    '   { "type": "vocab", "title": string,',
    '     "cards": [ { "term": string, "definition": string, "imagePrompt": string }, ... ] }  // 2-4 cards',
    "",
    "5. diagram (one big labelled illustration):",
    '   { "type": "diagram", "title": string, "caption": string,',
    '     "imagePrompt": string,            // REQUIRED for this type',
    '     "labels": [string, ...] }         // 2-6 parts the learner should notice',
    "",
    "6. process (step-by-step flow):",
    '   { "type": "process", "title": string, "intro": string,',
    '     "steps": [ { "label": string, "text": string, "imagePrompt": string }, ... ] }  // 2-4 steps',
    "",
    "Rules:",
    "- The FIRST slide MUST be a hero slide.",
    "- Include 6 to 10 slides total. Always include at least one vocab slide and at least one diagram or process slide.",
    "- Keep text short and learner-friendly for the grade.",
    "- Every imagePrompt must describe a single clean illustration with NO text/words/labels inside it.",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
