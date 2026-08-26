function routingError(message, { statusCode = 422, code = "VAPI_BUSINESS_ROUTE_REQUIRED" } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseBusinessId(value, field) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw routingError(`${field} must be a positive business identifier.`, {
      code: "VAPI_BUSINESS_ROUTE_INVALID",
    });
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw routingError(`${field} must be a valid business identifier.`, {
      code: "VAPI_BUSINESS_ROUTE_INVALID",
    });
  }
  return parsed;
}

function hasMappedCallContext(call = {}) {
  return Boolean(
    call.assistantId
      || call.assistant?.id
      || call.phoneNumberId
      || call.phoneNumber?.id
      || call.phoneNumber?.number
      || call.phoneNumber?.twilioPhoneNumber
      || call.destination?.number
      || call.to
      || call.metadata?.businessId
      || call.metadata?.companyId
  );
}

function getCallLookup(callId) {
  const value = String(callId || "").trim();
  if (!value) return null;
  const alternatives = [{ externalId: value }];
  if (/^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) alternatives.push({ id: parsed });
  }
  return { OR: alternatives };
}

async function resolveLegacyOwnerSmsBusinessRoute(
  payload = {},
  { prismaClient, resolveMappedBusinessId } = {}
) {
  if (!prismaClient?.business?.findUnique || !prismaClient?.call?.findFirst) {
    throw routingError("Business routing validation is unavailable.", {
      statusCode: 503,
      code: "VAPI_BUSINESS_ROUTE_UNAVAILABLE",
    });
  }

  const leadPayload = payload.lead && typeof payload.lead === "object" ? payload.lead : payload;
  const explicitIds = [
    parseBusinessId(payload.businessId, "businessId"),
    leadPayload !== payload ? parseBusinessId(leadPayload.businessId, "lead.businessId") : null,
  ].filter(Boolean);
  if (new Set(explicitIds).size > 1) {
    throw routingError("The supplied business identifiers do not match.", {
      statusCode: 409,
      code: "VAPI_BUSINESS_ROUTE_CONFLICT",
    });
  }

  const candidates = explicitIds.length
    ? [{ businessId: explicitIds[0], source: "explicit_business" }]
    : [];
  const call = payload.call && typeof payload.call === "object" ? payload.call : payload;
  const callId = String(payload.callId || call.id || payload.vapiCallId || "").trim();
  const callLookup = getCallLookup(callId);
  const localCall = callLookup
    ? await prismaClient.call.findFirst({ where: callLookup, select: { businessId: true } })
    : null;
  if (localCall?.businessId) {
    candidates.push({ businessId: Number(localCall.businessId), source: "stored_call" });
  }

  if (hasMappedCallContext(call)) {
    if (typeof resolveMappedBusinessId !== "function") {
      throw routingError("Mapped Vapi call routing validation is unavailable.", {
        statusCode: 503,
        code: "VAPI_BUSINESS_ROUTE_UNAVAILABLE",
      });
    }
    const mappedBusinessId = parseBusinessId(
      await resolveMappedBusinessId(call),
      "mapped businessId"
    );
    if (mappedBusinessId) {
      candidates.push({ businessId: mappedBusinessId, source: "vapi_mapping" });
    }
  } else if (callId && !localCall) {
    throw routingError("The supplied call could not be matched to a business.", {
      code: "VAPI_CALL_ROUTE_NOT_FOUND",
    });
  }

  const businessIds = [...new Set(candidates.map((candidate) => candidate.businessId))];
  if (!businessIds.length) {
    throw routingError("A trusted businessId or mapped Vapi call context is required.");
  }
  if (businessIds.length > 1) {
    throw routingError("The supplied business and call context resolve to different businesses.", {
      statusCode: 409,
      code: "VAPI_BUSINESS_ROUTE_CONFLICT",
    });
  }

  const businessId = businessIds[0];
  const business = await prismaClient.business.findUnique({
    where: { id: businessId },
    select: { id: true },
  });
  if (!business?.id) {
    throw routingError("The routed business does not exist.", {
      code: "VAPI_BUSINESS_ROUTE_NOT_FOUND",
    });
  }

  return {
    businessId,
    sources: [...new Set(candidates.map((candidate) => candidate.source))],
  };
}

module.exports = {
  getCallLookup,
  hasMappedCallContext,
  parseBusinessId,
  resolveLegacyOwnerSmsBusinessRoute,
};
