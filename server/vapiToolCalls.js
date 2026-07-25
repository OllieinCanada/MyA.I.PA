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

function firstObject(...values) {
  for (const value of values) {
    const parsed = parseObject(value);
    if (Object.keys(parsed).length) return parsed;
  }
  return {};
}

function normalizeVapiToolCall(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const wrapped = source.toolCall && typeof source.toolCall === "object" ? source.toolCall : {};
  const sourceFunction = source.function && typeof source.function === "object" ? source.function : {};
  const wrappedFunction = wrapped.function && typeof wrapped.function === "object" ? wrapped.function : {};
  const functionCall = source.functionCall && typeof source.functionCall === "object" ? source.functionCall : {};

  const id = String(
    source.id
      || source.toolCallId
      || source.tool_call_id
      || wrapped.id
      || functionCall.id
      || ""
  ).trim();
  const name = String(
    source.name
      || sourceFunction.name
      || wrapped.name
      || wrappedFunction.name
      || functionCall.name
      || ""
  ).trim();
  const parameters = firstObject(
    source.parameters,
    source.arguments,
    sourceFunction.parameters,
    sourceFunction.arguments,
    wrapped.parameters,
    wrapped.arguments,
    wrappedFunction.parameters,
    wrappedFunction.arguments,
    functionCall.parameters,
    functionCall.arguments
  );

  return {
    ...source,
    id,
    name,
    parameters,
  };
}

module.exports = {
  normalizeVapiToolCall,
  parseObject,
};
