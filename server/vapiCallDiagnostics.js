const crypto = require("crypto");

const CUSTOMER_SMS_TOOL = "send_customer_sms_dynamic";
const OWNER_SMS_TOOL = "send_owner_sms_dynamic";
const SMS_TOOLS = new Set([CUSTOMER_SMS_TOOL, OWNER_SMS_TOOL]);

function isCompositeSmsTool(name) {
  return /^send_call_summaries_/i.test(String(name || ""));
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

function last4(value) {
  return normalizePhone(value).slice(-4);
}

function shortId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function nestedString(value, paths) {
  for (const path of paths) {
    let cursor = value;
    for (const segment of String(path).split(".")) cursor = cursor?.[segment];
    if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
  }
  return "";
}

function getToolName(value) {
  return nestedString(value, ["name", "function.name"]);
}

function getToolArguments(value) {
  return parseObject(
    value?.parameters ??
      value?.arguments ??
      value?.args ??
      value?.function?.parameters ??
      value?.function?.arguments
  );
}

function safeToolArguments(value) {
  const args = getToolArguments(value);
  return {
    fromLast4: last4(args.fromNumber || args.from || args.senderNumber),
    // Keep the explicit tool destination separate from caller data. A missing
    // toNumber is meaningful because it shows that the code tool used a
    // fallback value instead of a destination supplied for this call.
    toLast4: last4(args.toNumber || args.to || args.destinationNumber),
    callerLast4: last4(args.rawPhoneNumber || args.callbackNumber || args.callerPhone),
    structuredFieldCount: [
      "businessName",
      "requestType",
      "name",
      "rawPhoneNumber",
      "jobDetails",
      "streetAddress",
      "city",
      "bestCallbackTime",
    ].filter((key) => String(args[key] || "").trim()).length,
    bodyProvided: Boolean(String(args.body || "").trim()),
  };
}

function safeToolResult(value) {
  const parsed = parseObject(value);
  const rawText = typeof value === "string" ? value.trim() : "";
  const rejectedByPlan = /rejected based on configured rejection plan/i.test(rawText);
  const error = parsed.error;
  const errorMessage =
    typeof error === "string"
      ? error
      : String(error?.message || parsed.errorMessage || parsed.message || "").trim();
  return {
    ok: typeof parsed.ok === "boolean" ? parsed.ok : (rejectedByPlan ? false : null),
    sent: typeof parsed.sent === "boolean" ? parsed.sent : (rejectedByPlan ? false : null),
    skipped: typeof parsed.skipped === "boolean" ? parsed.skipped : null,
    status: String(parsed.status || "").trim().slice(0, 80),
    errorCode: String(parsed.errorCode || parsed.code || error?.code || (rejectedByPlan ? "TOOL_CALL_REJECTED" : "")).trim().slice(0, 80),
    error: (rejectedByPlan
      ? "Vapi rejected the SMS tool before execution because the caller's confirmation did not match the configured approval rule."
      : errorMessage).slice(0, 240),
    messageIdSet: Boolean(parsed.sid || parsed.messageSid || parsed.messageId || parsed.requestId),
    fromLast4: String(parsed.fromLast4 || "").replace(/\D/g, "").slice(-4) || last4(parsed.from || parsed.fromNumber),
    toLast4: String(parsed.toLast4 || "").replace(/\D/g, "").slice(-4) || last4(parsed.to || parsed.toNumber),
    bodyBuiltByTool: typeof parsed.bodyBuiltByTool === "boolean" ? parsed.bodyBuiltByTool : null,
  };
}

function safeCompositeResult(value) {
  const parsed = parseObject(value);
  const directFailure = safeToolResult(value);
  const rejectedByPlan = directFailure.errorCode === "TOOL_CALL_REJECTED";
  return {
    ok: typeof parsed.ok === "boolean" ? parsed.ok : (rejectedByPlan ? false : null),
    complete: typeof parsed.complete === "boolean" ? parsed.complete : (rejectedByPlan ? false : null),
    partialSuccess: typeof parsed.partialSuccess === "boolean" ? parsed.partialSuccess : null,
    requiresReconciliation: typeof parsed.requiresReconciliation === "boolean" ? parsed.requiresReconciliation : null,
    toolRejected: rejectedByPlan,
    owner: rejectedByPlan ? directFailure : safeToolResult(parsed.owner),
    customer: rejectedByPlan ? directFailure : safeToolResult(parsed.customer),
  };
}

function collectSmsToolEvidence(call) {
  const calls = new Map();
  const results = [];
  const visited = new Set();

  function addCall(toolCall) {
    const name = getToolName(toolCall);
    if (!SMS_TOOLS.has(name) && !isCompositeSmsTool(name)) return;
    const rawId = String(toolCall?.id || toolCall?.toolCallId || toolCall?.tool_call_id || "").trim();
    const key = rawId || `${name}:${calls.size + 1}`;
    if (!calls.has(key)) {
      calls.set(key, {
        key,
        idHash: shortId(rawId),
        name,
        arguments: safeToolArguments(toolCall),
      });
    }
  }

  function visit(value) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    for (const key of ["toolCallList", "toolCalls", "tool_calls"]) {
      const items = Array.isArray(value[key]) ? value[key] : [];
      items.forEach(addCall);
    }

    const eventType = String(value.type || value.role || "").trim().toLowerCase();
    if (/tool[-_ ]?call/.test(eventType) && !/result/.test(eventType)) addCall(value);

    const toolCallId = String(value.toolCallId || value.tool_call_id || "").trim();
    if (toolCallId || /tool[-_ ]?(call[-_ ]?)?result/.test(eventType)) {
      const rawResult = value.result ?? value.output ?? value.content ?? value.message;
      const parsedResult = parseObject(rawResult);
      if (Object.keys(parsedResult).length || (typeof rawResult === "string" && rawResult.trim())) {
        results.push({
          toolCallId,
          name: getToolName(value),
          rawResult: Object.keys(parsedResult).length ? parsedResult : rawResult,
        });
      }
    }

    Object.values(value).forEach(visit);
  }

  visit(call);

  const evidence = [...calls.values()].map((toolCall) => {
    const matchingResults = results.filter(
      (item) =>
        (item.toolCallId && item.toolCallId === toolCall.key) ||
        (!item.toolCallId && item.name && item.name === toolCall.name)
    );
    const uniqueResults = matchingResults
      .map((item) => isCompositeSmsTool(toolCall.name) ? safeCompositeResult(item.rawResult) : safeToolResult(item.rawResult))
      .filter((result, index, items) =>
        index === items.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(result))
      );
    return {
      ...toolCall,
      results: uniqueResults,
    };
  });

  return evidence;
}

function summarizeCompositeRole(role, evidence) {
  const invocations = evidence.filter((item) => isCompositeSmsTool(item.name));
  const results = invocations.flatMap((item) => (item.results || []).map((result) => result?.[role]).filter(Boolean));
  const successful = results.some((result) => result.sent === true || (result.ok === true && !result.error && result.sent !== false));
  const failed = results.some((result) => result.sent === false || result.ok === false || Boolean(result.error || result.errorCode));
  return {
    invoked: invocations.length > 0,
    invocationCount: invocations.length,
    resultCount: results.length,
    successful,
    failed,
    calls: invocations.map(({ idHash, arguments, results: compositeResults }) => ({
      idHash,
      arguments,
      results: (compositeResults || []).map((result) => result?.[role]).filter(Boolean),
    })),
  };
}

function summarizeComposite(evidence) {
  const invocations = evidence.filter((item) => isCompositeSmsTool(item.name));
  const results = invocations.flatMap((item) => item.results || []);
  return {
    invoked: invocations.length > 0,
    invocationCount: invocations.length,
    resultCount: results.length,
    complete: results.some((result) => result.complete === true),
    partialSuccess: results.some((result) => result.partialSuccess === true),
    requiresReconciliation: results.some((result) => result.requiresReconciliation === true),
    toolRejected: results.some((result) => result.toolRejected === true),
    toolNames: [...new Set(invocations.map((item) => item.name))],
  };
}

function summarizeTool(name, evidence) {
  const invocations = evidence.filter((item) => item.name === name);
  const results = invocations.flatMap((item) => item.results || []);
  const successful = results.some(
    (result) => result.sent === true || (result.ok === true && !result.error && result.sent !== false)
  );
  const failed = results.some(
    (result) => result.sent === false || result.ok === false || Boolean(result.error || result.errorCode)
  );
  return {
    invoked: invocations.length > 0,
    invocationCount: invocations.length,
    resultCount: results.length,
    successful,
    failed,
    calls: invocations.map(({ idHash, arguments, results: callResults }) => ({ idHash, arguments, results: callResults })),
  };
}

function determineFinding(customer, owner) {
  if (customer.successful && !owner.invoked) {
    return {
      code: "OWNER_TOOL_NOT_CALLED",
      severity: "critical",
      summary: "The customer SMS succeeded, but Vapi did not invoke the owner SMS tool.",
      nextAction: "Inspect the live assistant prompt/tool-call turn and replace parallel best-effort invocation with a deterministic sequence or backend fallback.",
    };
  }
  if (owner.invoked && owner.resultCount === 0) {
    return {
      code: "OWNER_TOOL_RESULT_MISSING",
      severity: "critical",
      summary: "Vapi invoked the owner SMS tool, but no usable result was recorded.",
      nextAction: "Inspect the Vapi code-tool execution log and timeout/error details.",
    };
  }
  if (owner.failed) {
    return {
      code: "OWNER_TOOL_FAILED",
      severity: "critical",
      summary: "Vapi invoked the owner SMS tool and it returned a failure.",
      nextAction: "Use the redacted error code below to inspect Twilio delivery or tool configuration.",
    };
  }
  if (owner.successful) {
    return {
      code: "OWNER_TOOL_REPORTED_SUCCESS",
      severity: "warning",
      summary: "The owner tool reported success; receipt must be reconciled against the Twilio message status.",
      nextAction: "Look up the message SID in Twilio and confirm its final delivery status and destination.",
    };
  }
  return {
    code: "NO_CONFIRMED_OWNER_SMS",
    severity: "critical",
    summary: "The call does not contain evidence of a successful owner SMS.",
    nextAction: "Inspect the full Vapi tool timeline and Twilio message log.",
  };
}

function analyzeVapiSmsCall(call, options = {}) {
  const evidence = collectSmsToolEvidence(call);
  const composite = summarizeComposite(evidence);
  const customer = composite.invoked ? summarizeCompositeRole("customer", evidence) : summarizeTool(CUSTOMER_SMS_TOOL, evidence);
  const owner = composite.invoked ? summarizeCompositeRole("owner", evidence) : summarizeTool(OWNER_SMS_TOOL, evidence);
  const expectedCustomerLast4 = last4(options.customerPhone);
  const expectedOwnerLast4 = String(options.ownerLast4 || "").replace(/\D/g, "").slice(-4) || last4(options.ownerPhone);
  const expectedAiLast4 = last4(options.aiPhone);
  const destinationsFor = (summary) => [
    ...summary.calls.map((item) => item.arguments.toLast4),
    ...summary.calls.flatMap((item) => item.results.map((result) => result.toLast4)),
  ].filter(Boolean);
  const sendersFor = (summary) => [
    ...summary.calls.map((item) => item.arguments.fromLast4),
    ...summary.calls.flatMap((item) => item.results.map((result) => result.fromLast4)),
  ].filter(Boolean);
  const customerDestinations = destinationsFor(customer);
  const customerSenders = sendersFor(customer);
  const ownerDestinations = destinationsFor(owner);
  const ownerSenders = sendersFor(owner);
  const routing = {
    expectedCustomerLast4,
    expectedOwnerLast4,
    expectedAiLast4,
    customerDestinationLast4: [...new Set(customerDestinations)],
    customerSenderLast4: [...new Set(customerSenders)],
    ownerDestinationLast4: [...new Set(ownerDestinations)],
    ownerSenderLast4: [...new Set(ownerSenders)],
    customerDestinationMismatch: Boolean(expectedCustomerLast4 && customerDestinations.some((value) => value !== expectedCustomerLast4)),
    customerSenderMismatch: Boolean(expectedAiLast4 && customerSenders.some((value) => value !== expectedAiLast4)),
    ownerDestinationMismatch: Boolean(expectedOwnerLast4 && ownerDestinations.some((value) => value !== expectedOwnerLast4)),
    ownerSenderMismatch: Boolean(expectedAiLast4 && ownerSenders.some((value) => value !== expectedAiLast4)),
  };
  let finding = determineFinding(customer, owner);
  if (composite.toolRejected) {
    finding = {
      code: "SMS_CONFIRMATION_REJECTED",
      severity: "critical",
      summary: "Vapi blocked the SMS tool before Twilio was called because the caller's confirmation did not match the approval rule.",
      nextAction: "Update and retest the confirmation rule with natural phrases such as 'Yes, please.'",
    };
  } else if (routing.customerDestinationMismatch) {
    finding = {
      code: "CUSTOMER_DESTINATION_MISMATCH",
      severity: "critical",
      summary: "The customer SMS tool was given a destination that does not match the caller phone.",
      nextAction: "Correct caller-number extraction before another real call.",
    };
  } else if (routing.customerSenderMismatch) {
    finding = {
      code: "CUSTOMER_SENDER_MISMATCH",
      severity: "critical",
      summary: "The customer SMS tool was given a sender that does not match the assigned AI number.",
      nextAction: "Correct the live assistant's sender-number injection before another real call.",
    };
  } else if (routing.ownerDestinationMismatch) {
    finding = {
      code: "OWNER_DESTINATION_MISMATCH",
      severity: "critical",
      summary: "The owner SMS was sent to a destination that does not match the expected owner phone.",
      nextAction: "Replace the owner tool's unsafe fallback routing before another real call.",
    };
  } else if (routing.ownerSenderMismatch) {
    finding = {
      code: "OWNER_SENDER_MISMATCH",
      severity: "critical",
      summary: "The owner SMS tool was given a sender that does not match the assigned AI number.",
      nextAction: "Correct the live assistant's sender-number injection before another real call.",
    };
  } else if (composite.invoked && owner.successful && customer.successful && composite.complete) {
    finding = {
      code: "BOTH_SMS_ACCEPTED",
      severity: "healthy",
      summary: "The combined tool reported successful owner and customer SMS requests with the expected routing.",
      nextAction: "Reconcile both provider message IDs against their final Twilio delivery statuses.",
    };
  }

  return {
    call: {
      idHash: shortId(call?.id || call?.callId),
      createdAt: call?.createdAt || call?.startedAt || call?.created_at || null,
      endedAt: call?.endedAt || call?.ended_at || null,
      endedReason: String(call?.endedReason || "").trim().slice(0, 120),
      status: String(call?.status || "").trim().slice(0, 80),
      assistantIdHash: shortId(call?.assistantId || call?.assistant?.id),
      phoneNumberIdHash: shortId(call?.phoneNumberId || call?.phoneNumber?.id),
    },
    customer,
    owner,
    composite,
    routing,
    finding,
  };
}

module.exports = {
  CUSTOMER_SMS_TOOL,
  OWNER_SMS_TOOL,
  analyzeVapiSmsCall,
  collectSmsToolEvidence,
  isCompositeSmsTool,
  normalizePhone,
};
