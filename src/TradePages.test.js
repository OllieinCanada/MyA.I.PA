import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sharedCallFlow, tradePageOrder, tradePages } from "./tradePageData";
import { TRADE_OPTIONS } from "./features/signup/signupConfig";
import TradePages, { tradeCallIcons } from "./TradePages";

test("every public trade page has complete audience-specific content", () => {
  expect(tradePageOrder).toEqual([
    "electricians",
    "plumbers",
    "hvac",
    "general-contractors",
    "roofers",
    "painters",
  ]);

  tradePageOrder.forEach((slug) => {
    const trade = tradePages[slug];
    expect(trade.headline).toBeTruthy();
    expect(trade.intro.length).toBeGreaterThan(80);
    expect(trade.callerNeeds).toHaveLength(4);
    expect(trade.intake).toHaveLength(6);
    expect(trade.priorities).toHaveLength(3);
    expect(trade.questions.length).toBeGreaterThanOrEqual(6);
    expect(trade.boundaries).toHaveLength(4);
    expect(trade.scenario.owner).toMatch(/callback|address|requested|target/i);
  });
});

test("every trade in signup has one matching public flyer landing page", () => {
  const signupToPageSlug = {
    electrician: "electricians",
    plumber: "plumbers",
    hvac: "hvac",
    contractor: "general-contractors",
    roofer: "roofers",
    painter: "painters",
  };

  expect(TRADE_OPTIONS.map((trade) => signupToPageSlug[trade.id])).toEqual(tradePageOrder);
  expect(tradePageOrder.every((slug) => Boolean(tradePages[slug]))).toBe(true);
});

test("trade pages preserve conservative safety and truth boundaries", () => {
  const allBoundaries = tradePageOrder
    .flatMap((slug) => tradePages[slug].boundaries)
    .join(" ");
  expect(allBoundaries).toMatch(/does not diagnose|does not determine|does not quote/i);
  expect(allBoundaries).toMatch(/does not promise|does not claim/i);
  expect(tradePages.electricians.priorities[2][1]).toMatch(/shock|sparking|energized/i);
  expect(tradePages.hvac.priorities[2][1]).toMatch(/gas|carbon-monoxide/i);
  expect(tradePages.roofers.boundaries.join(" ")).toMatch(/climb onto a roof/i);
});

test("the visual call flow explains an end-to-end handoff", () => {
  expect(sharedCallFlow).toHaveLength(4);
  expect(sharedCallFlow.map((step) => step[1]).join(" ")).toMatch(/Caller explains|Trade-specific|Safety|clarity/);
});

test("every trade call card has a purposeful visual symbol", () => {
  tradePageOrder.forEach((slug) => {
    expect(tradeCallIcons[slug]).toHaveLength(tradePages[slug].callerNeeds.length);
    expect(tradeCallIcons[slug].every(Boolean)).toBe(true);
  });
});

test("every trade flyer renders the reference campaign structure without fabricated testimonials", () => {
  tradePageOrder.forEach((slug) => {
    const html = renderToStaticMarkup(<TradePages slug={slug} />);
    expect(html).toMatch(/STOP LOSING JOBS/);
    expect(html).toMatch(/NEVER MISS/);
    expect(html).toMatch(/HOW MY AI PA WORKS/);
    expect(html).toMatch(/MY AI PA HANDLES THE CALL/);
    expect(html).toMatch(/FREQUENTLY ASKED QUESTIONS/);
    expect(html).toMatch(/START MY 14-DAY FREE TRIAL/);
    expect(html).toMatch(/reference-contractor-hero-864\.jpg/);
    expect(html).toMatch(/reference-contractor-portrait-864\.jpg/);
    expect(html).toMatch(/You can&#x27;t answer the phone all the time/);
    expect(html).toMatch(/You shouldn&#x27;t miss out on .* jobs because you&#x27;re busy/);
    expect(html).toMatch(/My AI PA answers when you can&#x27;t/);
    expect(html).toMatch(/Turn voicemail hang-ups into job opportunities—24\/7/);
    expect(html).not.toMatch(/MIKE T\.|JASON R\.|ANDREW L\./i);
  });
});

