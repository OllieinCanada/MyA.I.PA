const fs = require("fs");
const path = require("path");
const {
  ensureDir,
  nodeCommand,
  rootPath,
  run,
} = require("./_helpers");

const outputDir = rootPath("diagnostics", "todos");
const visualReportPath = rootPath("diagnostics", "visual", "report.json");
const reportPath = path.join(outputDir, "todo-report.md");
const jsonPath = path.join(outputDir, "todo-report.json");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function addTodo(todos, item) {
  const key = `${item.area}|${item.title}`;
  if (todos.some((todo) => `${todo.area}|${todo.title}` === key)) return;
  todos.push(item);
}

function severityRank(severity) {
  return { high: 0, medium: 1, low: 2 }[severity] ?? 3;
}

function runVisualDiagnosticsIfRequested(baseUrl) {
  if (hasFlag("skip-visual")) return false;

  const result = run(
    nodeCommand(),
    [path.join("scripts", "diagnose-visual.js"), `--url=${baseUrl}`],
    { allowFailure: true }
  );

  return result.status === 0 || fs.existsSync(visualReportPath);
}

function collectVisualTodos(todos) {
  const report = readJsonIfExists(visualReportPath);
  if (!report || !Array.isArray(report.checks)) {
    addTodo(todos, {
      severity: "medium",
      area: "Automation",
      title: "Run visual diagnostics before the next design pass",
      evidence: "diagnostics/visual/report.json does not exist yet.",
      recommendation: "Start a preview, then run npm run find:todos -- --url=http://localhost:3001.",
    });
    return;
  }

  for (const check of report.checks) {
    const warnings = Array.isArray(check.warnings) ? check.warnings : [];
    for (const warning of warnings) {
      const warningLower = warning.toLowerCase();
      const severity =
        warningLower.includes("overflow") ||
        warningLower.includes("clipped") ||
        warningLower.includes("overlap") ||
        warningLower.includes("failed")
          ? "high"
          : "medium";

      addTodo(todos, {
        severity,
        area: `Visual: ${check.route}/${check.viewport}`,
        title: warning,
        evidence: check.screenshot || check.url || "Visual diagnostics warning.",
        recommendation: "Open the screenshot, inspect the affected viewport, then adjust the smallest layout area causing the issue.",
      });
    }

    const diagnostics = check.diagnostics || {};
    if (check.route === "home" && check.viewport === "firefox-window") {
      const dashboard = diagnostics.dashboard || {};
      if (!warnings.length && dashboard.dashboardRect) {
        addTodo(todos, {
          severity: "low",
          area: "Visual QA",
          title: "Manually inspect the Firefox-window hero screenshot",
          evidence: check.screenshot || "diagnostics/visual/home-firefox-window.png",
          recommendation: "This is the user's most sensitive viewport. Verify text readability, fold fit, and dashboard spacing before more design edits.",
        });
      }
    }
  }
}

function collectStaticTodos(todos) {
  const landing = readTextIfExists(rootPath("src", "LandingPage.js"));
  const signup = readTextIfExists(rootPath("src", "Signup.js"));
  const app = readTextIfExists(rootPath("src", "index.js"));
  const publicFiles = fs.existsSync(rootPath("public"))
    ? fs.readdirSync(rootPath("public"), { withFileTypes: true })
    : [];

  if (app.includes("ReactDOM.render")) {
    addTodo(todos, {
      severity: "low",
      area: "React",
      title: "Update React entrypoint to createRoot",
      evidence: "Browser console warns that ReactDOM.render is deprecated in React 18.",
      recommendation: "Switch src/index.js to react-dom/client createRoot when you are ready for a small framework hygiene task.",
    });
  }

  if (landing.includes("🍁")) {
    addTodo(todos, {
      severity: "low",
      area: "Brand polish",
      title: "Replace footer emoji with a styled brand-safe Canada mark",
      evidence: "Footer currently uses a maple leaf emoji.",
      recommendation: "Use a small inline SVG or text treatment so the footer looks consistent across platforms.",
    });
  }

  if (/testimonialCards[\s\S]*Mark S\./.test(landing)) {
    addTodo(todos, {
      severity: "medium",
      area: "Trust",
      title: "Verify testimonial authenticity and permission",
      evidence: "Landing page includes named testimonial-style quotes.",
      recommendation: "Confirm these are real approved testimonials, or label them as examples before deployment.",
    });
  }

  if (/External verification badges/.test(landing)) {
    addTodo(todos, {
      severity: "medium",
      area: "Conversion",
      title: "Replace internal trust-note copy with buyer-facing trust proof",
      evidence: "Trust section mentions external verification badges and implementation notes.",
      recommendation: "Use customer-friendly proof instead, such as privacy policy, Canadian business, trial terms, and real demo call evidence.",
    });
  }

  if (signup && landing) {
    const landingDarkSections = (landing.match(/bg-\[linear-gradient\(.*?#07142a|#07111f/g) || []).length;
    const signupDarkSections = (signup.match(/#07142a|#07111f|#10284a/g) || []).length;
    if (landingDarkSections > signupDarkSections + 3) {
      addTodo(todos, {
        severity: "medium",
        area: "Design consistency",
        title: "Bring signup page styling closer to the landing page",
        evidence: "Landing page now has more premium dark/proof sections than signup.",
        recommendation: "Audit signup screenshots and align form containers, headings, CTAs, and trust copy with the landing page visual system.",
      });
    }
  }

  const suspiciousPublicFiles = publicFiles
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes("import React") || /\.bak/i.test(name));

  if (suspiciousPublicFiles.length) {
    addTodo(todos, {
      severity: "low",
      area: "Repo hygiene",
      title: "Clean suspicious public assets",
      evidence: suspiciousPublicFiles.join(", "),
      recommendation: "Move accidental source or backup files out of public/ before deployment.",
    });
  }
}

function renderMarkdown(todos, baseUrl, visualRan) {
  const lines = [
    "# My AI PA TODO Finder",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Preview URL: ${baseUrl}`,
    `Visual diagnostics: ${visualRan ? "used" : "skipped or unavailable"}`,
    "",
  ];

  if (!todos.length) {
    lines.push("No obvious TODOs found by the automated checks.");
    lines.push("");
    lines.push("Manual next step: inspect the latest desktop and mobile screenshots for subjective design quality.");
    return `${lines.join("\n")}\n`;
  }

  const grouped = {
    high: todos.filter((todo) => todo.severity === "high"),
    medium: todos.filter((todo) => todo.severity === "medium"),
    low: todos.filter((todo) => todo.severity === "low"),
  };

  for (const severity of ["high", "medium", "low"]) {
    if (!grouped[severity].length) continue;
    lines.push(`## ${severity.toUpperCase()} Priority`);
    lines.push("");
    grouped[severity].forEach((todo, index) => {
      lines.push(`${index + 1}. **${todo.title}**`);
      lines.push(`   - Area: ${todo.area}`);
      lines.push(`   - Evidence: ${todo.evidence}`);
      lines.push(`   - Recommendation: ${todo.recommendation}`);
      lines.push("");
    });
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  ensureDir(outputDir);

  const baseUrl = getArg("url", process.env.TODO_URL || process.env.VISUAL_TEST_URL || "http://localhost:3001").replace(/\/+$/, "");
  const visualRan = runVisualDiagnosticsIfRequested(baseUrl);
  const todos = [];

  collectVisualTodos(todos);
  collectStaticTodos(todos);
  todos.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.area.localeCompare(b.area));

  fs.writeFileSync(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, todos }, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdown(todos, baseUrl, visualRan));

  console.log(`TODO report saved: ${reportPath}`);
  console.log("");
  if (!todos.length) {
    console.log("No obvious TODOs found.");
    return;
  }

  for (const todo of todos.slice(0, 8)) {
    console.log(`[${todo.severity.toUpperCase()}] ${todo.area}: ${todo.title}`);
  }
  if (todos.length > 8) console.log(`...and ${todos.length - 8} more in ${reportPath}`);
}

main();
