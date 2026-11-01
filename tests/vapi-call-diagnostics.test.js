const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeVapiSmsCall, CUSTOMER_SMS_TOOL, OWNER_SMS_TOOL } = require("../server/vapiCallDiagnostics");

function toolResult(toolCallId, name, result) {
  return { role: "tool", toolCallId, name, result: JSON.stringify(result) };
}

test("diagnostic identifies the exact customer-success owner-not-called incident", () => {
  const call = {
    id: "call-sensitive-id",
    createdAt: "2026-07-16T14:00:00.000Z",
    artifact: {
      messages: [
        {
          role: "assistant",
          toolCallList: [
            {
              id: "customer-call-1",
              name: "send_customer_sms_dynamic",
              parameters: {
                fromNumber: "+12494682588",
                rawPhoneNumber: "+19055551234",
                jobDetails: "private job details that must not appear in the report",
              },
            },
          ],
        },
        toolResult("customer-call-1", "send_customer_sms_dynamic", {
          ok: true,
          sent: true,
          sid: "SM-sensitive-id",
          to: "+19055551234",
          body: "private customer message",
        }),
      ],
    },
  };

  const report = analyzeVapiSmsCall(call, { aiPhone: "+12494682588", ownerPhone: "+19055551234", customerPhone: "+19055551234" });
  assert.equal(report.customer.invoked, true);
  assert.equal(report.customer.successful, true);
  assert.equal(report.owner.invoked, false);
  assert.equal(report.finding.code, "OWNER_TOOL_NOT_CALLED");
  assert.equal(report.finding.severity, "critical");
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private job details|private customer message|19055551234|SM-sensitive-id|call-sensitive-id/);
});

test("diagnostic keeps an owner tool failure separate from customer success", () => {
  const call = {
    id: "call-2",
    artifact: {
      messages: [
        {
          type: "tool-calls",
          toolCallList: [
            { id: "customer-2", name: "send_customer_sms_dynamic", parameters: { fromNumber: "+12494682588", rawPhoneNumber: "+19055551234" } },
            { id: "owner-2", name: "send_owner_sms_dynamic", parameters: { fromNumber: "+12494682588", toNumber: "+19055551234" } },
          ],
        },
        toolResult("customer-2", "send_customer_sms_dynamic", { ok: true, sent: true, sid: "SM1" }),
        toolResult("owner-2", "send_owner_sms_dynamic", { ok: false, sent: false, errorCode: "21610", error: "recipient opted out" }),
      ],
    },
  };
  const report = analyzeVapiSmsCall(call, { aiPhone: "+12494682588", ownerPhone: "+19055551234", customerPhone: "+19055551234" });
  assert.equal(report.customer.successful, true);
  assert.equal(report.owner.invoked, true);
  assert.equal(report.owner.failed, true);
  assert.equal(report.finding.code, "OWNER_TOOL_FAILED");
  assert.equal(report.owner.calls[0].results[0].errorCode, "21610");
});

test("diagnostic flags an owner destination mismatch before treating a send as healthy", () => {
  const call = {
    id: "call-3",
    messages: [
      {
        role: "assistant",
        toolCalls: [
          { id: "owner-3", function: { name: "send_owner_sms_dynamic", arguments: JSON.stringify({ fromNumber: "+12494682588", toNumber: "+19055550000" }) } },
        ],
      },
      toolResult("owner-3", "send_owner_sms_dynamic", { ok: true, sent: true, sid: "SM2" }),
    ],
  };
  const report = analyzeVapiSmsCall(call, { aiPhone: "+12494682588", ownerPhone: "+19055551234" });
  assert.equal(report.owner.successful, true);
  assert.equal(report.routing.ownerDestinationMismatch, true);
  assert.equal(report.finding.code, "OWNER_DESTINATION_MISMATCH");
  assert.deepEqual(report.routing.ownerDestinationLast4, ["0000"]);
});

test("diagnostic distinguishes caller data from a missing explicit owner destination and deduplicates copied results", () => {
  const repeatedResult = toolResult("owner-4", "send_owner_sms_dynamic", {
    ok: true,
    sent: true,
    sid: "SM4",
    from: "+19055555417",
    to: "+19055557422",
  });
  const call = {
    id: "call-4",
    artifact: {
      messages: [
        {
          role: "assistant",
          toolCallList: [
            {
              id: "owner-4",
              name: "send_owner_sms_dynamic",
              parameters: { rawPhoneNumber: "+19055555488" },
            },
          ],
        },
        repeatedResult,
      ],
      copiedMessages: [repeatedResult],
    },
  };

  const report = analyzeVapiSmsCall(call, {
    aiPhone: "+12494682588",
    ownerLast4: "5488",
  });
  assert.equal(report.owner.calls[0].arguments.toLast4, "");
  assert.equal(report.owner.calls[0].arguments.callerLast4, "5488");
  assert.equal(report.owner.resultCount, 1);
  assert.deepEqual(report.routing.ownerDestinationLast4, ["7422"]);
  assert.equal(report.routing.ownerDestinationMismatch, true);
  assert.equal(report.finding.code, "OWNER_DESTINATION_MISMATCH");
});

test("diagnostic recognizes the isolated composite tool and verifies both routes", () => {
  const call = {
    id: "call-composite",
    artifact: {
      messages: [
        {
          role: "assistant",
          toolCallList: [{
            id: "composite-1",
            name: "send_call_summaries_pilot_2588_v1",
            parameters: { rawPhoneNumber: "+19055555488", businessName: "Test Electrical", requestType: "installation", name: "Test Caller" },
          }],
        },
        toolResult("composite-1", "send_call_summaries_pilot_2588_v1", {
          ok: true,
          complete: true,
          partialSuccess: false,
          requiresReconciliation: false,
          owner: { sent: true, status: "queued", messageId: "SM_OWNER_SECRET", fromLast4: "2588", toLast4: "5488" },
          customer: { sent: true, status: "queued", messageId: "SM_CUSTOMER_SECRET", fromLast4: "2588", toLast4: "5488" },
        }),
      ],
    },
  };
  const report = analyzeVapiSmsCall(call, { aiPhone: "+12494682588", ownerLast4: "5488", customerPhone: "+19055555488" });
  assert.equal(report.composite.invoked, true);
  assert.equal(report.composite.complete, true);
  assert.equal(report.owner.successful, true);
  assert.equal(report.customer.successful, true);
  assert.equal(report.finding.code, "BOTH_SMS_ACCEPTED");
  assert.equal(report.finding.severity, "healthy");
  assert.doesNotMatch(JSON.stringify(report), /SM_OWNER_SECRET|SM_CUSTOMER_SECRET/);
});

test("diagnostic explains a Vapi confirmation-gate rejection before Twilio is called", () => {
  const call = {
    id: "call-confirmation-rejected",
    artifact: {
      messages: [
        {
          role: "assistant",
          toolCallList: [{
            id: "composite-rejected-1",
            name: "send_call_summaries_7487_test_v2",
            parameters: { businessName: "Private test", requestType: "constituent_demo", name: "Test Caller" },
          }],
        },
        {
          role: "tool",
          toolCallId: "composite-rejected-1",
          name: "send_call_summaries_7487_test_v2",
          result: "Tool call rejected based on configured rejection plan",
        },
      ],
    },
  };

  const report = analyzeVapiSmsCall(call, { aiPhone: "+12892057487", ownerLast4: "5488", customerPhone: "+19055555488" });
  assert.equal(report.composite.invoked, true);
  assert.equal(report.composite.toolRejected, true);
  assert.equal(report.owner.failed, true);
  assert.equal(report.customer.failed, true);
  assert.equal(report.finding.code, "SMS_CONFIRMATION_REJECTED");
  assert.match(report.finding.summary, /before notification execution/i);
  assert.equal(report.finding.causeConfirmed, false);
  assert.equal(report.finding.stage, "pre_execution_guard");
  assert.equal(report.finding.rejectedInvocationCount, 1);
  assert.equal(report.finding.otherOrUnknownInvocationCount, 0);
  assert.doesNotMatch(JSON.stringify(report), /because the caller's confirmation did not match/i);
  assert.match(report.finding.nextAction, /Do not blame the caller.*automatically resend/i);
  assert.doesNotMatch(JSON.stringify(report), /call-confirmation-rejected|Test Caller/);
});

test("a rejected attempt preserves another combined attempt's reported submission", () => {
  const call = { artifact: { messages: [
    { role: "assistant", toolCallList: [
      { id: "reported", name: "send_call_summaries_test" },
      { id: "rejected", name: "send_call_summaries_test" },
    ] },
    { role: "tool", toolCallId: "reported", result: JSON.stringify({ complete: true,
      owner: { sent: true, sid: "SM_PRIVATE_OWNER" }, customer: { sent: true, sid: "SM_PRIVATE_CUSTOMER" } }) },
    { role: "tool", toolCallId: "rejected", result: "Tool call rejected based on configured rejection plan" },
  ] } };
  const report = analyzeVapiSmsCall(call);
  assert.equal(report.finding.code, "SMS_CONFIRMATION_REJECTED");
  assert.equal(report.finding.rejectedInvocationCount, 1);
  assert.equal(report.finding.otherOrUnknownInvocationCount, 1);
  assert.equal(report.owner.successful, true);
  assert.equal(report.customer.successful, true);
  assert.match(report.finding.summary, /reconciled separately/);
  assert.doesNotMatch(report.finding.summary, /neither text|Twilio was not called|no SMS was sent/i);
  assert.doesNotMatch(JSON.stringify(report), /SM_PRIVATE_OWNER|SM_PRIVATE_CUSTOMER/);
});

for (const role of ["customer", "owner"]) for (const reported of [true, false]) {
  test(`a rejected combined attempt retains a legacy ${role} attempt with ${reported ? "reported submission" : "unknown outcome"}`, () => {
    const legacyName = role === "customer" ? CUSTOMER_SMS_TOOL : OWNER_SMS_TOOL;
    const messages = [
      { role: "assistant", toolCallList: [{ id: "combined", name: "send_call_summaries_test" }, { id: "legacy", name: legacyName }] },
      { role: "tool", toolCallId: "combined", result: "Tool call rejected based on configured rejection plan" },
    ];
    if (reported) messages.push({ role: "tool", toolCallId: "legacy", result: JSON.stringify({ sent: true, sid: "SM_LEGACY_PRIVATE" }) });
    const report = analyzeVapiSmsCall({ artifact: { messages } });
    assert.equal(report.notificationAttempts.rejectedInvocationCount, 1);
    assert.equal(report.notificationAttempts.otherOrUnknownInvocationCount, 1);
    assert.equal(report[role].invocationCount, 2);
    assert.equal(report[role].successful, reported);
    assert.match(report.finding.summary, /reconciled separately/);
    assert.doesNotMatch(JSON.stringify(report), /SM_LEGACY_PRIVATE/);
  });
}

test("repeated copies of one rejection do not become additional notification attempts", () => {
  const result = { role: "tool", toolCallId: "same", result: "Tool call rejected based on configured rejection plan" };
  const report = analyzeVapiSmsCall({ artifact: { messages: [
    { role: "assistant", toolCallList: [{ id: "same", name: "send_call_summaries_test" }] }, result, { ...result },
  ] } });
  assert.equal(report.notificationAttempts.rejectedInvocationCount, 1);
  assert.equal(report.notificationAttempts.otherOrUnknownInvocationCount, 0);
});

test("a legacy guard rejection has neutral cause and stage reporting", () => {
  const report = analyzeVapiSmsCall({ artifact: { messages: [
    { role: "assistant", toolCallList: [{ id: "legacy-rejected", name: OWNER_SMS_TOOL }] },
    { role: "tool", toolCallId: "legacy-rejected", result: "Tool call rejected based on configured rejection plan" },
  ] } });
  assert.equal(report.finding.code, "SMS_CONFIRMATION_REJECTED");
  assert.equal(report.finding.causeConfirmed, false);
  assert.equal(report.finding.rejectedInvocationCount, 1);
});
