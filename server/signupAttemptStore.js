const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function requireSecret(secret) {
  const value = String(secret || "").trim();
  if (value.length < 24) {
    const error = new Error("A durable signup status secret of at least 24 characters is required.");
    error.code = "SIGNUP_STATUS_SECRET_REQUIRED";
    throw error;
  }
  return value;
}

function deriveSignupStatusAccess(eventKey, secret) {
  const normalizedEventKey = String(eventKey || "").trim();
  if (!/^signup_[a-f0-9]{32}$/.test(normalizedEventKey)) {
    const error = new Error("A valid signup event key is required.");
    error.code = "SIGNUP_EVENT_KEY_INVALID";
    throw error;
  }
  const signingSecret = requireSecret(secret);
  const token = crypto
    .createHmac("sha256", signingSecret)
    .update(`signup-status:v1:${normalizedEventKey}`)
    .digest("base64url");
  return {
    publicId: `attempt_${sha256(normalizedEventKey).slice(0, 20)}`,
    token,
    tokenHash: sha256(token),
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function customerStatus(record = {}) {
  const status = String(record.status || "signup_received").toLowerCase();
  const assignedPhone = String(record.assignedPhone || "").trim();
  if (status === "setup_ready" && assignedPhone && !record.reviewRequired) {
    return {
      state: "ready",
      title: "Your My AI PA number is ready.",
      message: "Your assistant passed the required setup checks and is ready for private testing.",
      assignedPhone,
      terminal: true,
    };
  }
  if (status === "rejected") {
    return {
      state: "closed",
      title: "This pilot signup was not activated.",
      message: "No phone number or assistant was assigned. Contact My AI PA if you think this was a mistake.",
      assignedPhone: "",
      terminal: true,
    };
  }
  if (status === "superseded_duplicate") {
    return {
      state: "closed",
      title: "This duplicate signup was closed.",
      message: "We are continuing your original signup. Contact My AI PA if you need help finding it.",
      assignedPhone: "",
      terminal: true,
    };
  }
  if (/error|failed/i.test(status)) {
    return {
      state: "needs_attention",
      title: "We found a setup issue.",
      message: "Your information is safe and our team has been notified. Do not submit the signup again.",
      assignedPhone: "",
      terminal: false,
    };
  }
  if (/verification/i.test(status)) {
    return {
      state: "verification_required",
      title: "Please verify your contact information.",
      message: "Open the verification message we sent before setup can continue.",
      assignedPhone: "",
      terminal: false,
    };
  }
  if (record.reviewRequired || /review/i.test(status)) {
    return {
      state: "final_checks",
      title: "Final safety checks are underway.",
      message: "You do not need to resubmit anything. We will continue this signup from where it stopped.",
      assignedPhone: "",
      terminal: false,
    };
  }
  return {
    state: "processing",
    title: "We are preparing your assistant.",
    message: "This page checks automatically. Do not submit another signup.",
    assignedPhone: "",
    terminal: false,
  };
}

function publicAttempt(record = {}) {
  const status = customerStatus(record);
  return {
    id: record.publicId,
    ...status,
    stage: String(record.stage || "received"),
    businessName: String(record.businessName || ""),
    supportRequested: Boolean(record.supportRequestedAt),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt || ""),
  };
}

function createSignupAttemptStore({ prisma, secret, ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  if (!prisma?.signupAttempt) throw new Error("SignupAttempt database storage is unavailable.");
  const signingSecret = requireSecret(secret);
  const statusTtlMs = Math.max(60 * 60 * 1000, Number(ttlMs) || 0);

  async function register({ eventKey, payload, businessName, ownerEmail, ownerPhone, status = "signup_received", stage = "received", reviewRequired = false, reviewReasons = [] } = {}) {
    const access = deriveSignupStatusAccess(eventKey, signingSecret);
    const data = {
      publicId: access.publicId,
      statusTokenHash: access.tokenHash,
      businessName: String(businessName || "").trim(),
      ownerEmail: String(ownerEmail || "").trim().toLowerCase(),
      ownerPhone: String(ownerPhone || "").trim() || null,
      payload: payload || {},
      status,
      stage,
      reviewRequired: Boolean(reviewRequired),
      reviewReasons: Array.isArray(reviewReasons) ? reviewReasons : [],
      expiresAt: new Date(Date.now() + statusTtlMs),
    };
    // Atomic create-or-read: only explicit workflow transitions may alter an
    // existing attempt. A browser retry must not reset progress, extend access,
    // or send another verification message for the same submission ID.
    let record;
    let reused = false;
    if (typeof prisma.signupAttempt.create === "function") {
      try {
        record = await prisma.signupAttempt.create({ data: { eventKey, ...data } });
      } catch (error) {
        if (String(error?.code || "") !== "P2002") throw error;
        record = await prisma.signupAttempt.findUnique({ where: { eventKey } });
        reused = true;
      }
    } else {
      const existing = await prisma.signupAttempt.findUnique({ where: { eventKey } });
      record = await prisma.signupAttempt.upsert({
        where: { eventKey },
        create: { eventKey, ...data },
        update: {},
      });
      reused = Boolean(existing);
    }
    if (!record) throw new Error("The signup attempt could not be created or recovered.");
    return { access: { id: access.publicId, token: access.token }, record, public: publicAttempt(record), reused };
  }

  async function authenticate(publicId, token) {
    const record = await prisma.signupAttempt.findUnique({ where: { publicId: String(publicId || "").trim() } });
    const expiresAt = new Date(record?.expiresAt).getTime();
    if (!record || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !constantTimeEqual(record.statusTokenHash, sha256(token))) return null;
    return record;
  }

  async function update(eventKey, values = {}) {
    const data = { ...values };
    if (data.reviewReasons !== undefined && !Array.isArray(data.reviewReasons)) data.reviewReasons = [];
    return prisma.signupAttempt.update({ where: { eventKey }, data });
  }

  async function updateIfPresent(eventKey, values = {}) {
    const existing = await prisma.signupAttempt.findUnique({ where: { eventKey } });
    if (!existing) return null;
    return update(eventKey, values);
  }

  async function requestSupport(record, description) {
    const cleaned = String(description || "").replace(/\s+/g, " ").trim().slice(0, 1200);
    if (cleaned.length < 8) {
      const error = new Error("Briefly describe what is not working.");
      error.statusCode = 400;
      throw error;
    }
    return prisma.signupAttempt.update({
      where: { id: record.id },
      data: { supportDescription: cleaned, supportRequestedAt: new Date() },
    });
  }

  return { authenticate, publicAttempt, register, requestSupport, update, updateIfPresent };
}

module.exports = {
  createSignupAttemptStore,
  customerStatus,
  deriveSignupStatusAccess,
  publicAttempt,
};
