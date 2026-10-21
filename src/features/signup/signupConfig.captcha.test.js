test("signup defaults to two independent CAPTCHA providers when both public keys exist", () => {
  const original = process.env.REACT_APP_CAPTCHA_PROVIDER;
  delete process.env.REACT_APP_CAPTCHA_PROVIDER;
  jest.resetModules();
  const config = require("./signupConfig");
  expect(config.CAPTCHA_PROVIDER).toBe("turnstile+recaptcha");
  expect(config.RECAPTCHA_MODE).toBe("checkbox");
  expect(config.USE_RECAPTCHA_ENTERPRISE).toBe(false);
  if (original === undefined) delete process.env.REACT_APP_CAPTCHA_PROVIDER;
  else process.env.REACT_APP_CAPTCHA_PROVIDER = original;
  jest.resetModules();
});

test("an explicit Cloudflare-only rollback configuration remains available", () => {
  const original = process.env.REACT_APP_CAPTCHA_PROVIDER;
  process.env.REACT_APP_CAPTCHA_PROVIDER = "turnstile";
  jest.resetModules();
  expect(require("./signupConfig").CAPTCHA_PROVIDER).toBe("turnstile");
  if (original === undefined) delete process.env.REACT_APP_CAPTCHA_PROVIDER;
  else process.env.REACT_APP_CAPTCHA_PROVIDER = original;
  jest.resetModules();
});
