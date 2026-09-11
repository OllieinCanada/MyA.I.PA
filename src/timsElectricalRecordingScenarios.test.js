import recordingScenarios from "../config/tims-electrical-recording-scenarios.json";
import audioManifest from "./timsElectricalAudioManifest.json";
import recordedCaptions from "./timsElectricalRecordedScenarioCaptions.json";

const rerecordedIds = [
  "repair-request",
  "maintenance",
  "unresolved-concern",
];
const exactDialogueIds = recordingScenarios
  .filter((scenario) => Array.isArray(scenario.exactDialogue) && scenario.exactDialogue.length > 0)
  .map((scenario) => scenario.id);

const activeVapiV2Voices = new Set(["Emma", "Kai", "Naina"]);

describe("Tim's Electrical recorded scenario scripts", () => {
  const scenarios = rerecordedIds.map((id) => recordingScenarios.find((scenario) => scenario.id === id));

  test("defines every rerecorded scenario", () => {
    expect(scenarios.every(Boolean)).toBe(true);
  });

  test("uses a distinct active caller voice and a clear performance direction", () => {
    const voices = scenarios.map((scenario) => scenario.callerVoiceId);
    expect(new Set(voices).size).toBe(rerecordedIds.length);
    expect(voices.every((voice) => activeVapiV2Voices.has(voice))).toBe(true);
    expect(scenarios.every((scenario) => scenario.callerPerformance.length > 20)).toBe(true);
  });

  test.each(exactDialogueIds)("%s starts with the exact receptionist opening and alternates speakers", (id) => {
    const scenario = recordingScenarios.find((item) => item.id === id);
    expect(scenario.exactDialogue[0]).toEqual({
      role: "receptionist",
      text: "Hi, thanks for calling Tim’s Electrical. We handle residential, commercial, and industrial electrical work. Do you need maintenance, a new installation, or a repair today?",
    });
    expect(
      scenario.exactDialogue.every(
        (turn, index) => index === 0 || turn.role !== scenario.exactDialogue[index - 1].role,
      ),
    ).toBe(true);
  });

  test("the safety recording redirects immediately without collecting routine lead details", () => {
    const scenario = recordingScenarios.find((item) => item.id === "safety-redirect");
    const script = scenario.exactDialogue.map((turn) => turn.text).join(" ");
    expect(script).toMatch(/leave.*immediately/i);
    expect(script).toMatch(/call 911/i);
    expect(script).not.toMatch(/name|address|callback number/i);
  });

  test("new installation asks for callback timing before the caller provides it", () => {
    const dialogue = recordingScenarios.find((item) => item.id === "new-installation").exactDialogue;
    const callbackQuestionIndex = dialogue.findIndex((turn) => /best time to reach you/i.test(turn.text));
    const callbackAnswerIndex = dialogue.findIndex((turn) => /After five PM is best/i.test(turn.text));
    expect(callbackQuestionIndex).toBeGreaterThan(-1);
    expect(callbackAnswerIndex).toBe(callbackQuestionIndex + 1);
    expect(dialogue[callbackQuestionIndex].role).toBe("receptionist");
    expect(dialogue[callbackAnswerIndex].role).toBe("caller");
  });

  test.each(["hero-new-installation", "new-installation"])("%s collects preferred start and confirms the handoff", (id) => {
    const dialogue = recordingScenarios.find((item) => item.id === id).exactDialogue;
    const preferredStartQuestionIndex = dialogue.findIndex((turn) => /preferred start date/i.test(turn.text));
    const preferredStartAnswerIndex = dialogue.findIndex((turn) => /Next week would be ideal/i.test(turn.text));
    const missedAnythingIndex = dialogue.findIndex((turn) => /Did I miss anything important\?/i.test(turn.text));
    const handoffIndex = dialogue.findIndex((turn) => /We'll pass this information and we'll get back to you for pricing and scheduling\./i.test(turn.text));
    expect(preferredStartQuestionIndex).toBeGreaterThan(-1);
    expect(preferredStartAnswerIndex).toBe(preferredStartQuestionIndex + 1);
    expect(missedAnythingIndex).toBeGreaterThan(preferredStartAnswerIndex);
    expect(handoffIndex).toBe(missedAnythingIndex + 2);
    expect(dialogue[preferredStartQuestionIndex].role).toBe("receptionist");
    expect(dialogue[preferredStartAnswerIndex].role).toBe("caller");
    expect(dialogue[handoffIndex].role).toBe("receptionist");
  });

  test("keeps serious safety examples out of the personality-recording playlist", () => {
    expect(audioManifest["urgent-outage"].status).toBe("visual-only");
    expect(audioManifest["safety-redirect"].status).toBe("visual-only");
  });

  test.each(rerecordedIds)("%s ships a complete prepared recording and synchronized captions", (id) => {
    const scenario = recordingScenarios.find((item) => item.id === id);
    const audio = audioManifest[id];
    const captions = recordedCaptions[id];
    expect(audio.status).toBe("available");
    expect(audio.src).toBe(`/audio/tims-electrical/${id}.wav`);
    expect(audio.callerVoiceId).toBe(scenario.callerVoiceId);
    expect(audio.durationSeconds).toBeGreaterThan(20);
    expect(audio.durationSeconds).toBeLessThan(70);
    expect(captions).toHaveLength(scenario.exactDialogue.length);
    expect(captions[captions.length - 1].startSeconds).toBeLessThan(audio.durationSeconds);
  });
});
