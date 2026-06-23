function createShortAnswerHandlers({
  onCall,
  HttpsError,
  cleanString,
  stripJsonFences,
  callAnthropic,
  getAnthropicApiKey,
  anthropicApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
}) {
  const MAX_LEN = {
    question: 1200,
    correctAnswer: 600,
    studentAnswer: 600,
    subject: 80,
    grade: 20,
  };
  const MARKING_EQUIVALENCES =
    "Accept common school terms and scientific terms as equivalent when they " +
    "refer to the same concept. Examples: alveoli = air sacs; oesophagus = " +
    "food pipe; trachea = windpipe; larynx = voice box; stomata = leaf pores; " +
    "photosynthesis = making food using sunlight. A more precise term should " +
    "not be marked wrong because the expected answer uses a simpler term. " +
    "Do not say alveoli are different from air sacs; in primary science, air " +
    "sacs in the lungs are alveoli. For breathing terms: respiration can be " +
    "another name for breathing; inhaling/inhalation means breathing in only; " +
    "exhaling/exhalation means breathing out only. Mark false only when the student's answer " +
    "contradicts the concept or answers a different question. ";
  const TEACHER_MARKING_SCHEME =
    "When an expected answer is provided, treat it as the teacher's marking " +
    "scheme. If the student's answer matches that expected answer or a clear " +
    "equivalent, mark it correct even when another wording might be more " +
    "scientifically complete. ";

  function parseMarkerResponse(raw) {
    try {
      const parsed = JSON.parse(stripJsonFences(raw));
      return {
        correct: Boolean(parsed.correct),
        feedback: cleanString(parsed.feedback, 160) ||
          "Answer checked. Review the expected answer.",
      };
    } catch {
      throw new HttpsError(
          "internal",
          "The marker could not read the AI response. Please try again.",
      );
    }
  }

  const checkShortAnswer = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 30,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "checkShortAnswer");

        const question = cleanString(request.data?.question, MAX_LEN.question);
        const correctAnswer = cleanString(
            request.data?.correctAnswer,
            MAX_LEN.correctAnswer,
        );
        const studentAnswer = cleanString(
            request.data?.studentAnswer,
            MAX_LEN.studentAnswer,
        );
        const subject = cleanString(request.data?.subject, MAX_LEN.subject);
        const grade = cleanString(request.data?.grade, MAX_LEN.grade);

        if (!question || !studentAnswer) {
          throw new HttpsError(
              "invalid-argument",
              "Question and student answer are required.",
          );
        }

        const context = [grade ? `Grade ${grade}` : "", subject]
            .filter(Boolean)
            .join(", ");
        const systemPrompt =
          "You are a helpful exam marker for Zambian primary school students" +
          `${context ? ` (${context})` : ""}. ` +
          (correctAnswer
            ? "Mark answers as correct if they match the expected answer, including " +
              "minor spelling mistakes, synonyms, equivalent phrasing, or valid " +
              "abbreviations. " +
              TEACHER_MARKING_SCHEME
            : "No expected answer was provided. Use the question, grade, subject, " +
              "and standard primary-school knowledge to judge whether the student's " +
              "answer is factually correct. If the question is ambiguous, mark it " +
              "incorrect and tell the learner to review the question. ") +
          MARKING_EQUIVALENCES +
          "Always respond with only valid JSON. No prose, no code fences, just the JSON object.";

        const userPrompt = `Question: "${question}"
Expected answer: "${correctAnswer || "Not provided"}"
Student's answer: "${studentAnswer}"

Respond in this exact JSON format:
{"correct": true, "feedback": "Short encouraging message (max 15 words)"}
or
{"correct": false, "feedback": "Short explanation of correct answer (max 15 words)"}`;

        const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
          systemPrompt,
          messages: [{role: "user", content: userPrompt}],
          maxTokens: 200,
          temperature: 0.1,
          json: true,
          track: {uid: request.auth.uid, tool: "markAnswer"},
        });
        return parseMarkerResponse(raw);
      },
  );

  return {checkShortAnswer};
}

module.exports = {createShortAnswerHandlers};
