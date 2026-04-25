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

function buildToolDefinitions() {
  return [
    firestoreSummarize.definition,
    trackerTasks.listDefinition,
    trackerTasks.addDefinition,
    draftCodexPrompt.definition,
    generateContent.definition,
    reviewFirebase.definition,
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
