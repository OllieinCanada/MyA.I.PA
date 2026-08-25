import timsElectricalRecordedScenarioCaptions from "./timsElectricalRecordedScenarioCaptions.json";

// These captions mirror the prepared WAV files in public/audio/tims-electrical.
// Scenario captions are generated from the locked script and measured speech
// boundaries so the conversation follows the recording instead of estimating.
export const timsElectricalRecordedTranscripts = {
  "new-installation": [
    { speaker: "assistant", startSeconds: 0.75, text: "Thanks for calling the Tim's Electrical recorded demonstration. I'm the virtual receptionist. This synthetic call is being recorded. How can I help today?" },
    { speaker: "caller", startSeconds: 11, text: "I need a licensed electrician to wire a newly installed hot tub." },
    { speaker: "assistant", startSeconds: 17.55, text: "I can help with that. May I have your full name, please?" },
    { speaker: "caller", startSeconds: 22.4, text: "Brian Smith." },
    { speaker: "assistant", startSeconds: 25.45, text: "Thanks, Brian. What is the address where the hot tub wiring is needed?" },
    { speaker: "caller", startSeconds: 31.3, text: "23 Robb Street in Hamilton." },
    { speaker: "assistant", startSeconds: 35.8, text: "Got it. And what phone number can we use to reach you back?" },
    { speaker: "caller", startSeconds: 41.05, text: "905-555-1234. After 5 p.m. is best." },
    { speaker: "assistant", startSeconds: 49.3, text: "Thanks, Brian. To confirm, your callback number is 905-555-1234, and after 5 p.m. is the best time to reach you. Is that correct?" },
    { speaker: "caller", startSeconds: 61, text: "Yes, that's correct." },
    { speaker: "assistant", startSeconds: 64.4, text: "Thanks, Brian. To recap, you need wiring for a newly installed hot tub at 23 Robb Street in Hamilton. Your callback number is 905-555-1234, and after 5 p.m. is the best time to reach you. This demonstration would pass that organized summary to the team. Did I miss anything important?" },
    { speaker: "caller", startSeconds: 84, text: "Goodbye." },
  ],
  ...timsElectricalRecordedScenarioCaptions,
};
