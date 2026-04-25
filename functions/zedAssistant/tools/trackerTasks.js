/**
 * Feature/task tracker for the Zed assistant.
 *
 * Stored in Firestore at zedAssistantTasks/. This is the assistant's own
 * collection — never exposed to learners. Used to persist the "what's
 * unfinished" list (games, quiz editor, leaderboard, CBC weakness detection,
 * etc.) so the assistant can answer "what's left?" across conversations.
 *
 * Two tools: list_tasks (read), add_task (write — the only Firestore write
 * the assistant is allowed to perform on behalf of the user).
 */

const admin = require("firebase-admin");

const COLLECTION = "zedAssistantTasks";
const VALID_AREAS = [
  "games",
  "quiz_editor",
  "leaderboard",
  "cbc_weakness",
  "admin",
  "content",
  "infra",
  "other",
];
const VALID_STATUSES = ["todo", "in_progress", "blocked", "done"];

const listDefinition = {
  name: "list_tasks",
  description:
    "List unfinished or in-progress ZedExams features tracked in the " +
    "assistant's task tracker. Use when the user asks 'what's left?', " +
    "'what's unfinished?', or asks for a status update on a specific area " +
    "(games, quiz editor, leaderboard, CBC weakness detection, etc.).",
  input_schema: {
    type: "object",
    properties: {
      area: {
        type: "string",
        enum: VALID_AREAS,
        description: "Filter by area. Omit to list across all areas.",
      },
      status: {
        type: "string",
        enum: VALID_STATUSES,
        description: "Filter by status. Defaults to all open statuses.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Max items to return. Default 20.",
      },
    },
  },
};

const addDefinition = {
  name: "add_task",
  description:
    "Add a new task or unfinished feature to the assistant's tracker. " +
    "Use when the user says 'remind me about X', 'don't forget X is " +
    "unfinished', or 'add a task to do Y'. Always confirm the title with " +
    "the user before calling this tool unless they were explicit. " +
    "This is the only write operation the assistant performs.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 3,
        maxLength: 140,
        description: "Short title — what needs to happen.",
      },
      area: {
        type: "string",
        enum: VALID_AREAS,
        description: "Which part of the product this belongs to.",
      },
      notes: {
        type: "string",
        maxLength: 1000,
        description: "Optional longer notes / acceptance criteria.",
      },
      status: {
        type: "string",
        enum: VALID_STATUSES,
        description: "Initial status. Defaults to 'todo'.",
      },
    },
    required: ["title", "area"],
  },
};

async function listTasks(input = {}) {
  const area = VALID_AREAS.includes(input.area) ? input.area : null;
  const status = VALID_STATUSES.includes(input.status) ? input.status : null;
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 20));

  let query = admin.firestore().collection(COLLECTION);
  if (area) query = query.where("area", "==", area);
  if (status) {
    query = query.where("status", "==", status);
  } else {
    query = query.where("status", "in", ["todo", "in_progress", "blocked"]);
  }
  query = query.limit(limit);

  let snap;
  try {
    snap = await query.get();
  } catch (err) {
    // Composite-index errors are common when filtering by area + status
    // before the index is built. Fall back to a simpler query.
    if (String(err?.message || "").includes("index")) {
      snap = await admin.firestore().collection(COLLECTION).limit(limit).get();
    } else {
      throw err;
    }
  }

  const tasks = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      title: data.title,
      area: data.area,
      status: data.status,
      notes: data.notes || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  });
  return {count: tasks.length, tasks};
}

async function addTask(input = {}, {createdByChatId} = {}) {
  const title = String(input.title || "").trim().slice(0, 140);
  const area = VALID_AREAS.includes(input.area) ? input.area : "other";
  const status = VALID_STATUSES.includes(input.status) ? input.status : "todo";
  const notes = String(input.notes || "").trim().slice(0, 1000) || null;

  if (title.length < 3) {
    throw new Error("Title is required (>=3 chars).");
  }

  const ref = admin.firestore().collection(COLLECTION).doc();
  await ref.set({
    title,
    area,
    status,
    notes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: "zedAssistant",
    createdByChatId: createdByChatId || null,
  });
  return {id: ref.id, title, area, status};
}

module.exports = {
  listDefinition,
  addDefinition,
  listTasks,
  addTask,
  COLLECTION,
};
