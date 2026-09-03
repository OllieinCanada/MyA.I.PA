const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeVapiSmsCall } = require("../server/vapiCallDiagnostics");

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
  assert.match(report.finding.summary, /before Twilio was called/i);
  assert.doesNotMatch(JSON.stringify(report), /call-confirmation-rejected|Test Caller/);
});
