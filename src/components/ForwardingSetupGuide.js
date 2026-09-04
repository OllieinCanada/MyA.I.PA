import React, { useMemo } from "react";

function localDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function getForwardingGuide(assignedNumber) {
  const number = localDigits(assignedNumber);
  if (number.length !== 10) return [];
  return [
    { carrier: "Rogers or Fido mobile", steps: [`Dial *61*${number}#`, "Press Call. Then test from another phone."], note: "If voicemail answers first, ask your carrier to adjust no-answer forwarding." },
    { carrier: "Freedom mobile", steps: [`Dial *61*${number}#`, "Press Call. Then test from another phone."] },
    { carrier: "Bell mobile", steps: ["Open Phone settings, then Call forwarding.", `Choose unanswered/no reply and enter ${number}.`, "Wait for Bell's confirmation text. Then test."] },
    { carrier: "TELUS, Koodo, or another mobile carrier", steps: ["Open Phone settings, then Call forwarding.", `Choose unanswered/no reply and enter ${number}.`, "If you cannot see that option, ask your carrier for no-answer forwarding."] },
    { carrier: "Rogers home phone", steps: ["Dial *92 and listen for the tone.", `Enter ${number}.`, "Answer the forwarded call or stay on for five seconds. Then test."], note: "Rogers home phone forwards after about four rings." },
    { carrier: "Landline or business phone system", steps: [`Set a no-answer or overflow rule to ${number}.`, "Choose roughly 15–20 seconds if your provider allows it. Then test."] },
  ];
}

export default function ForwardingSetupGuide({ assignedNumber, compact = false }) {
  const guides = useMemo(() => getForwardingGuide(assignedNumber), [assignedNumber]);
  const [first, ...rest] = guides;
  if (!first) return null;
  return (
    <section className={`forwarding-guide${compact ? " is-compact" : ""}`} aria-labelledby="forwarding-guide-title">
      <div className="forwarding-guide-heading">
        <span>AFTER ABOUT 3 RINGS</span>
        <h2 id="forwarding-guide-title">Forward unanswered calls</h2>
        <p>Your phone rings first. If you cannot answer, My AI PA takes over. Carrier timing varies, so always test from another phone.</p>
      </div>
      <details open>
        <summary>{first.carrier}</summary>
        <ol>{first.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        {first.note ? <small>{first.note}</small> : null}
      </details>
      {rest.map((guide) => (
        <details key={guide.carrier}>
          <summary>{guide.carrier}</summary>
          <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          {guide.note ? <small>{guide.note}</small> : null}
        </details>
      ))}
    </section>
  );
}
