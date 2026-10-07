const test=require("node:test"),assert=require("node:assert/strict");
const {assessSpeechLogs}=require("../server/vapiSpeechDiagnostics");
const expected="Glad to hear it. Before we continue, this call will be recorded for service quality and accurate follow-up. Is that okay?";
const fixture=spoken=>[{attributes:{event:"assistant.model.responseSucceeded",completionText:expected}},{attributes:{event:"assistant.transcriber.finalTranscript",channel:"assistant",transcript:spoken}}];
test("college K regression requires audio review, not a fabricated TTS diagnosis",()=>{const r=assessSpeechLogs(fixture("Glad to hear it. Before we continue, college K and all of these involve us. This call will be recorded for quality and accurate follow-up."));assert.equal(r.status,"speech_review_required");assert.equal(r.audioVerified,false);});
test("matching transcription is not automatically an audio pass",()=>{const r=assessSpeechLogs(fixture(expected));assert.equal(r.status,"transcript_consistent");assert.equal(r.audioVerified,false);});
test("missing logs fail closed and caller speech cannot count as assistant speech",()=>{assert.equal(assessSpeechLogs([]).status,"insufficient_speech_evidence");const logs=fixture(expected);logs[1].attributes.channel="user";assert.equal(assessSpeechLogs(logs).status,"insufficient_speech_evidence");});
