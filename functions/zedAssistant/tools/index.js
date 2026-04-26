/**
 * Tool registry — defines what the Zed Telegram assistant can do.
 *
 * Each tool exports `{definition, run}`. The webhook handler builds the
 * tools[] array sent to Anthropic and a `runTool(name, input)` dispatcher
 * that invokes the right module. New tools only need to be added in this
 * one place.
 *
 * Keep this list small and high-signal. The model's accuracy on tool
 * routing degrades as the toolbox grows.
 */

const firestoreSummarize = require("./firestoreSummarize");
const trackerTasks = require("./trackerTasks");
const draftCodexPrompt = require("./draftCodexPrompt");
const generateContent = require("./generateContent");
const reviewFirebase = require("./reviewFirebase");

// Anthropic-hosted server tool. Anthropic executes web_search and inlines
// results in the assistant turn — our agent loop and runTool dispatcher
// don't need to know about it. max_uses caps per-message search count so a
// runaway prompt can't run up the Anthropic-side search bill.
//
// We intentionally do NOT set user_location: Zambia (ZM) is not in
// Anthropic's supported country list and including it 400s the request.
// The model can bias toward Zambian sources by mentioning "Zambia" in
// the query string instead.
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

// web_fetch loads a specific URL's contents (web_search only returns
// snippets). Required for "go look at zedexams.com/about and tell me
// what's on it" — the URL must come from the user's message or from
// a prior search/fetch result; the model can't fabricate URLs.
//
// citations.enabled forces the model to cite the URL inline so the
// founder always knows what the bot read. max_content_tokens caps how
// much of a page we'll load — 30k is enough for any normal page and
// keeps token usage predictable. max_uses limits per-message fetches.
const WEB_FETCH_TOOL = {
  type: "web_fetch_20250910",
  name: "web_fetch",
  max_uses: 5,
  max_content_tokens: 30000,
  citations: {enabled: true},
};

function buildToolDefinitions() {
  return [
    firestoreSummarize.definition,
    trackerTasks.listDefinition,
    trackerTasks.addDefinition,
    draftCodexPrompt.definition,
    generateContent.definition,
    reviewFirebase.definition,
    WEB_SEARCH_TOOL,
    WEB_FETCH_TOOL,
  ];
}

function buildToolRunner({chatId} = {}) {
  return async function runTool(name, input) {
    switch (name) {
      case "summarize_admin":
        return firestoreSummarize.run(input);
      case "list_tasks":
        return trackerTasks.listTasks(input);
      case "add_task":
        return trackerTasks.addTask(input, {createdByChatId: chatId});
      case "draft_codex_prompt":
        return draftCodexPrompt.run(input);
      case "generate_content":
        return generateContent.run(input);
      case "review_firebase":
        return reviewFirebase.run(input);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}

module.exports = {buildToolDefinitions, buildToolRunner};
