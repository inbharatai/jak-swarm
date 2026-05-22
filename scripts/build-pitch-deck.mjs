import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const pptxgen = require("pptxgenjs");
const sharp = require("sharp");

const screenshotDir = path.join(repoRoot, "deck-assets", "screenshots");
const outputDir = path.join(repoRoot, "docs", "pitch");
const previewDir = path.join(outputDir, "previews");

const sourcePlaywright = path.join(repoRoot, "qa", "playwright-artifacts", "a-to-z", "workflows");

function findDirectoryWithFile(root, fileName) {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === fileName)) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
      }
    }
  }
  throw new Error(`Could not find ${fileName} under ${root}`);
}

const sourceAssets = findDirectoryWithFile(path.join(repoRoot, "qa"), "12-vibe-builder-generated-proof.png");

const screenshots = [
  {
    name: "01-dashboard-overview.png",
    source: path.join(sourceAssets, "03-workspace.png"),
    caption: "JAK Swarm workspace where a founder gives one natural-language task and chooses the specialist role.",
    sourceLabel: "local demo capture: workspace command screen",
    slides: [4],
  },
  {
    name: "02-workflow-planning.png",
    source: path.join(sourceAssets, "09-leadership-roundtable-proof.png"),
    caption: "Captured workflow proof showing multiple leadership-style agent outputs from the demo run.",
    sourceLabel: "local demo capture: leadership workflow proof",
    slides: [5],
  },
  {
    name: "03-jak-shield-approval.png",
    source: path.join(sourceAssets, "04-approvals-inbox.png"),
    caption: "Approval inbox surface used as the current protected-action gate; external JAK Shield MCP remains separate.",
    sourceLabel: "local demo capture: approval inbox",
    slides: [6],
  },
  {
    name: "04-audit-trail.png",
    source: path.join(sourcePlaywright, "audit-trace-expanded.png"),
    caption: "Swarm Inspector trace list showing completed runs, timing, and agent-trace evidence.",
    sourceLabel: "local Playwright capture: audit trace expanded",
    slides: [7],
  },
  {
    name: "05-role-picker-proof.png",
    source: path.join(sourceAssets, "08-workspace-role-picker-proof.png"),
    caption: "Role picker proof for CEO, CTO, CMO, researcher, coding, design, automation, and sales-like workflows.",
    sourceLabel: "local demo capture: role picker",
    slides: [7],
  },
  {
    name: "06-vibe-builder-generated-proof.png",
    source: path.join(sourceAssets, "12-vibe-builder-generated-proof.png"),
    caption: "Vibe Builder captured generating a small app artifact from a plain-English prompt.",
    sourceLabel: "local demo capture: builder generated output",
    slides: [7],
  },
  {
    name: "07-company-os-landing.png",
    source: path.join(sourceAssets, "02-company-os.png"),
    caption: "Landing-page proof for the company operating-layer positioning and closed-loop alignment story.",
    sourceLabel: "local demo capture: company operating-layer landing section",
    slides: [1],
  },
];

const C = {
  ink: "0A1412",
  muted: "53615D",
  faint: "E7ECE8",
  green: "36D68F",
  deep: "061411",
  gold: "D4A94E",
  white: "FFFFFF",
  panel: "F7FAF8",
  danger: "D85B56",
};

const slideW = 13.333;
const slideH = 7.5;
let activePptx;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hexToRgba(hex, alpha = 1) {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

async function roundedCopy(input, output) {
  const image = sharp(input).resize(1440, 900, { fit: "cover" }).png();
  const mask = Buffer.from(
    `<svg width="1440" height="900"><rect x="0" y="0" width="1440" height="900" rx="44" ry="44" fill="white"/></svg>`,
  );
  await image.composite([{ input: mask, blend: "dest-in" }]).png().toFile(output);
}

async function prepareScreenshots() {
  ensureDir(screenshotDir);
  for (const item of screenshots) {
    if (!fs.existsSync(item.source)) {
      throw new Error(`Missing screenshot source: ${item.source}`);
    }
    await roundedCopy(item.source, path.join(screenshotDir, item.name));
  }
}

function addBg(slide, color = C.white) {
  slide.background = { color };
  slide.addShape(activePptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: slideW,
    h: slideH,
    fill: { color },
    line: { color, transparency: 100 },
  });
}

function addKicker(slide, text, x, y, color = C.green) {
  slide.addText(text.toUpperCase(), {
    x,
    y,
    w: 3.6,
    h: 0.24,
    fontFace: "Aptos",
    fontSize: 8.5,
    bold: true,
    charSpace: 1.2,
    color,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
}

function addTitle(slide, title, subtitle, theme = "light") {
  const dark = theme === "dark";
  slide.addText(title, {
    x: 0.62,
    y: 0.55,
    w: 5.0,
    h: 1.08,
    fontFace: "Aptos Display",
    fontSize: 30,
    bold: true,
    color: dark ? C.white : C.ink,
    margin: 0,
    fit: "shrink",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.64,
      y: 1.58,
      w: 5.0,
      h: 0.42,
      fontFace: "Aptos",
      fontSize: 11.5,
      color: dark ? "BFD2CA" : C.muted,
      margin: 0,
      fit: "shrink",
    });
  }
}

function addFooter(slide, n, theme = "light") {
  slide.addText(`JAK Swarm pitch deck / ${n}`, {
    x: 0.65,
    y: 7.12,
    w: 2.2,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 6.5,
    color: theme === "dark" ? "9DAEA7" : "86938F",
    margin: 0,
  });
}

function addCaption(slide, text, x, y, w, theme = "light") {
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 8.5,
    italic: true,
    color: theme === "dark" ? "B9CEC5" : C.muted,
    margin: 0,
    fit: "shrink",
  });
}

function addShot(slide, name, x, y, w, h) {
  slide.addShape(activePptx.ShapeType.roundRect, {
    x: x + 0.03,
    y: y + 0.05,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: "000000", transparency: 88 },
    line: { color: "000000", transparency: 100 },
  });
  slide.addImage({
    path: path.join(screenshotDir, name),
    x,
    y,
    w,
    h,
    sizingCrop: true,
  });
}

function addPill(slide, text, x, y, w, color = C.green, textColor = C.ink) {
  slide.addShape(activePptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.32,
    rectRadius: 0.08,
    fill: { color, transparency: 8 },
    line: { color, transparency: 50 },
  });
  slide.addText(text, {
    x: x + 0.12,
    y: y + 0.085,
    w: w - 0.24,
    h: 0.12,
    fontFace: "Aptos",
    fontSize: 7.5,
    bold: true,
    color: textColor,
    margin: 0,
    align: "center",
    fit: "shrink",
  });
}

function addBullet(slide, text, x, y, w, color = C.ink) {
  slide.addShape(activePptx.ShapeType.ellipse, {
    x,
    y: y + 0.06,
    w: 0.08,
    h: 0.08,
    fill: { color: C.green },
    line: { color: C.green },
  });
  slide.addText(text, {
    x: x + 0.2,
    y,
    w,
    h: 0.34,
    fontFace: "Aptos",
    fontSize: 11.5,
    color,
    margin: 0,
    fit: "shrink",
  });
}

function addMetric(slide, value, label, x, y, w) {
  slide.addText(value, {
    x,
    y,
    w,
    h: 0.52,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: C.ink,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(label, {
    x,
    y: y + 0.5,
    w,
    h: 0.32,
    fontFace: "Aptos",
    fontSize: 8.5,
    color: C.muted,
    margin: 0,
    fit: "shrink",
  });
}

function buildDeck() {
  const pptx = new pptxgen();
  activePptx = pptx;
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "InBharat AI";
  pptx.company = "InBharat AI";
  pptx.subject = "JAK Swarm pitch deck";
  pptx.title = "JAK Swarm Pitch Deck";
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };
  pptx.defineLayout({ name: "LAYOUT_WIDE", width: slideW, height: slideH });

  // 1. Cover
  {
    const slide = pptx.addSlide();
    addBg(slide, C.deep);
    slide.addShape(activePptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: slideW,
      h: slideH,
      fill: { color: C.deep },
      line: { color: C.deep },
    });
    slide.addImage({
      path: path.join(screenshotDir, "07-company-os-landing.png"),
      x: 7.15,
      y: 0.75,
      w: 5.45,
      h: 3.41,
      transparency: 8,
      sizingCrop: true,
    });
    slide.addShape(activePptx.ShapeType.rect, {
      x: 6.8,
      y: 0,
      w: 6.6,
      h: 7.5,
      fill: { color: "061411", transparency: 24 },
      line: { color: "061411", transparency: 100 },
    });
    addKicker(slide, "InBharat AI / JAK Swarm", 0.68, 0.72);
    slide.addText("The closed-loop AI operator\nfor founder-led teams", {
      x: 0.68,
      y: 1.34,
      w: 6.6,
      h: 1.62,
      fontFace: "Aptos Display",
      fontSize: 33,
      bold: true,
      color: C.white,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(
      "Give JAK a business task. It plans, routes specialists, asks for approval before risky actions, and leaves audit evidence.",
      {
        x: 0.72,
        y: 3.1,
        w: 5.8,
        h: 0.72,
        fontFace: "Aptos",
        fontSize: 14.5,
        color: "BFD2CA",
        margin: 0,
        fit: "shrink",
      },
    );
    addPill(slide, "Natural language -> approved work", 0.72, 4.15, 2.35, C.green, C.ink);
    addPill(slide, "Founder-led team wedge", 3.22, 4.15, 2.0, "F6D37B", C.ink);
    slide.addText("Actual product screenshot from the demo capture.", {
      x: 7.3,
      y: 4.34,
      w: 4.7,
      h: 0.28,
      fontFace: "Aptos",
      fontSize: 8.5,
      italic: true,
      color: "B9CEC5",
      margin: 0,
    });
    addFooter(slide, 1, "dark");
  }

  // 2. Problem
  {
    const slide = pptx.addSlide();
    addBg(slide, "FBF8F1");
    addKicker(slide, "Problem", 0.65, 0.55, C.danger);
    slide.addText("AI answers. It still does not safely run company work.", {
      x: 0.65,
      y: 1.05,
      w: 7.5,
      h: 1.0,
      fontFace: "Aptos Display",
      fontSize: 30,
      bold: true,
      color: C.ink,
      margin: 0,
      fit: "shrink",
    });
    const items = [
      ["Context is scattered", "Slack, GitHub, docs, tickets, calls, and founder decisions drift apart."],
      ["Agents are open-loop", "They produce outputs, but rarely verify against intent or downstream risk."],
      ["Trust breaks at action time", "Publishing, emailing, deploying, or touching data needs approvals and evidence."],
    ];
    items.forEach((item, i) => {
      const y = 2.55 + i * 1.18;
      slide.addText(`0${i + 1}`, {
        x: 0.78,
        y,
        w: 0.58,
        h: 0.4,
        fontFace: "Aptos Display",
        fontSize: 18,
        bold: true,
        color: C.danger,
        margin: 0,
      });
      slide.addText(item[0], {
        x: 1.55,
        y: y - 0.04,
        w: 3.0,
        h: 0.3,
        fontFace: "Aptos Display",
        fontSize: 17,
        bold: true,
        color: C.ink,
        margin: 0,
        fit: "shrink",
      });
      slide.addText(item[1], {
        x: 1.55,
        y: y + 0.34,
        w: 4.85,
        h: 0.36,
        fontFace: "Aptos",
        fontSize: 10.2,
        color: C.muted,
        margin: 0,
        fit: "shrink",
      });
    });
    slide.addShape(activePptx.ShapeType.arc, {
      x: 8.2,
      y: 1.35,
      w: 3.7,
      h: 3.7,
      adjustPoint: 0.35,
      line: { color: C.green, width: 4, transparency: 18 },
    });
    ["Meetings", "Tickets", "Code", "Docs", "Customers"].forEach((label, i) => {
      const positions = [
        [8.05, 1.7],
        [10.15, 1.25],
        [11.15, 3.0],
        [9.15, 4.7],
        [7.65, 3.55],
      ];
      slide.addShape(activePptx.ShapeType.roundRect, {
        x: positions[i][0],
        y: positions[i][1],
        w: 1.35,
        h: 0.45,
        rectRadius: 0.08,
        fill: { color: C.white },
        line: { color: "D9E4DE" },
      });
      slide.addText(label, {
        x: positions[i][0] + 0.1,
        y: positions[i][1] + 0.14,
        w: 1.15,
        h: 0.12,
        align: "center",
        fontFace: "Aptos",
        fontSize: 8.2,
        bold: true,
        color: C.ink,
        margin: 0,
      });
    });
    slide.addText("fragmented context", {
      x: 8.45,
      y: 5.35,
      w: 3.0,
      h: 0.3,
      fontFace: "Aptos Display",
      fontSize: 20,
      bold: true,
      color: C.ink,
      align: "center",
      margin: 0,
    });
    addFooter(slide, 2);
  }

  // 3. Wedge
  {
    const slide = pptx.addSlide();
    addBg(slide, C.white);
    addKicker(slide, "MVP wedge", 0.65, 0.55);
    slide.addText("Start with the workflows founders already run every week.", {
      x: 0.65,
      y: 1.08,
      w: 8.2,
      h: 0.78,
      fontFace: "Aptos Display",
      fontSize: 29,
      bold: true,
      color: C.ink,
      margin: 0,
      fit: "shrink",
    });
    const lanes = [
      ["Research", "competitors, customers, market notes"],
      ["Content", "LinkedIn drafts, launch posts, brand voice"],
      ["Code Review", "repo review, test plans, deployment checks"],
      ["Outreach", "lead research, drafts, approvals before send"],
    ];
    lanes.forEach((lane, i) => {
      const x = 0.86 + i * 3.02;
      slide.addShape(activePptx.ShapeType.roundRect, {
        x,
        y: 2.58,
        w: 2.45,
        h: 2.42,
        rectRadius: 0.14,
        fill: { color: i % 2 === 0 ? "F4FBF7" : "FFF9EB" },
        line: { color: i % 2 === 0 ? "BDEFD7" : "F2D78D" },
      });
      slide.addText(lane[0], {
        x: x + 0.18,
        y: 2.88,
        w: 2.05,
        h: 0.42,
        fontFace: "Aptos Display",
        fontSize: 17,
        bold: true,
        color: C.ink,
        margin: 0,
        fit: "shrink",
      });
      slide.addText(lane[1], {
        x: x + 0.2,
        y: 3.42,
        w: 1.92,
        h: 0.55,
        fontFace: "Aptos",
        fontSize: 9.6,
        color: C.muted,
        margin: 0,
        fit: "shrink",
      });
      slide.addShape(activePptx.ShapeType.line, {
        x: x + 0.2,
        y: 4.36,
        w: 1.85,
        h: 0,
        line: { color: i % 2 === 0 ? C.green : C.gold, width: 2 },
      });
      slide.addText("plan -> route -> approve -> audit", {
        x: x + 0.2,
        y: 4.58,
        w: 1.95,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 7.7,
        bold: true,
        color: C.ink,
        margin: 0,
        fit: "shrink",
      });
    });
    slide.addText("Positioning discipline: this deck does not claim every enterprise connector is production-ready today.", {
      x: 0.82,
      y: 6.03,
      w: 7.2,
      h: 0.26,
      fontFace: "Aptos",
      fontSize: 9,
      color: C.muted,
      italic: true,
      margin: 0,
    });
    addFooter(slide, 3);
  }

  // 4. Solution screenshot
  {
    const slide = pptx.addSlide();
    addBg(slide, C.deep);
    addTitle(slide, "One task becomes\na controlled workflow.", "The current product exposes a workspace for role-aware command execution.", "dark");
    addShot(slide, "01-dashboard-overview.png", 5.45, 1.08, 7.08, 4.42);
    addCaption(slide, screenshots[0].caption, 5.55, 5.68, 6.8, "dark");
    addBullet(slide, "Plain-English task entry, not a low-level framework UI.", 0.72, 2.32, 4.0, "EAF7F1");
    addBullet(slide, "Role selection supports CEO/CTO/CMO-style routing surfaces.", 0.72, 3.02, 4.0, "EAF7F1");
    addBullet(slide, "Designed for founder-led teams that need outcomes, control, and evidence.", 0.72, 3.72, 4.0, "EAF7F1");
    addFooter(slide, 4, "dark");
  }

  // 5. How it works
  {
    const slide = pptx.addSlide();
    addBg(slide, "F7FAF8");
    addTitle(slide, "How JAK closes the loop.", "Company context feeds plans; agents execute; risky actions pause for human approval.", "light");
    const steps = ["Context", "Plan", "Route", "Execute", "Verify", "Approve", "Audit"];
    steps.forEach((step, i) => {
      const x = 0.72 + i * 1.1;
      slide.addShape(activePptx.ShapeType.ellipse, {
        x,
        y: 2.0,
        w: 0.46,
        h: 0.46,
        fill: { color: i < 5 ? C.green : C.gold },
        line: { color: i < 5 ? C.green : C.gold },
      });
      if (i < steps.length - 1) {
        slide.addShape(activePptx.ShapeType.line, {
          x: x + 0.46,
          y: 2.23,
          w: 0.64,
          h: 0,
          line: { color: "B8C8C0", width: 1.5 },
        });
      }
      slide.addText(step, {
        x: x - 0.16,
        y: 2.58,
        w: 0.8,
        h: 0.18,
        fontFace: "Aptos",
        fontSize: 7.6,
        bold: true,
        color: C.ink,
        align: "center",
        margin: 0,
        fit: "shrink",
      });
    });
    addShot(slide, "02-workflow-planning.png", 7.28, 1.25, 5.3, 3.31);
    addCaption(slide, screenshots[1].caption, 7.34, 4.75, 5.0);
    slide.addText("The honest next milestone is durability: persistent graph state, resumable approvals, and connector-backed execution at production depth.", {
      x: 0.72,
      y: 4.1,
      w: 5.75,
      h: 0.7,
      fontFace: "Aptos Display",
      fontSize: 18,
      bold: true,
      color: C.ink,
      margin: 0,
      fit: "shrink",
    });
    addFooter(slide, 5);
  }

  // 6. Trust layer
  {
    const slide = pptx.addSlide();
    addBg(slide, "071613");
    addKicker(slide, "JAK Shield path", 0.65, 0.55);
    slide.addText("The trust layer sits between\nagents and real-world actions.", {
      x: 0.65,
      y: 1.05,
      w: 5.0,
      h: 1.18,
      fontFace: "Aptos Display",
      fontSize: 28,
      bold: true,
      color: C.white,
      margin: 0,
      fit: "shrink",
    });
    addShot(slide, "03-jak-shield-approval.png", 6.0, 1.05, 6.42, 4.02);
    addCaption(slide, screenshots[2].caption, 6.1, 5.24, 5.95, "dark");
    addBullet(slide, "Risky tool calls should become explicit approval cards.", 0.75, 2.58, 4.65, "EAF7F1");
    addBullet(slide, "Approval must bind to the exact payload being executed.", 0.75, 3.22, 4.65, "EAF7F1");
    addBullet(slide, "Audit logs must survive refreshes, workers, and retries.", 0.75, 3.86, 4.65, "EAF7F1");
    slide.addText("Blunt status: current screenshots prove the approval/audit product surfaces, not a fully independent JAK Shield MCP integration.", {
      x: 0.77,
      y: 5.35,
      w: 4.85,
      h: 0.46,
      fontFace: "Aptos",
      fontSize: 9.2,
      color: "BFD2CA",
      italic: true,
      margin: 0,
      fit: "shrink",
    });
    addFooter(slide, 6, "dark");
  }

  // 7. Product status
  {
    const slide = pptx.addSlide();
    addBg(slide, C.white);
    addTitle(slide, "What already exists in the demo build.", "Real captured screens, placed as proof points rather than mocked traction.", "light");
    const cards = [
      ["05-role-picker-proof.png", "Role-aware command surface", screenshots[4].caption],
      ["06-vibe-builder-generated-proof.png", "Vibe Builder output", screenshots[5].caption],
      ["04-audit-trail.png", "Run evidence and traces", screenshots[3].caption],
    ];
    cards.forEach((card, i) => {
      const x = 0.75 + i * 4.2;
      addShot(slide, card[0], x, 2.02, 3.7, 2.31);
      slide.addText(card[1], {
        x,
        y: 4.55,
        w: 3.6,
        h: 0.28,
        fontFace: "Aptos Display",
        fontSize: 14.5,
        bold: true,
        color: C.ink,
        margin: 0,
        fit: "shrink",
      });
      slide.addText(card[2], {
        x,
        y: 4.96,
        w: 3.54,
        h: 0.62,
        fontFace: "Aptos",
        fontSize: 8.4,
        color: C.muted,
        margin: 0,
        fit: "shrink",
      });
    });
    addFooter(slide, 7);
  }

  // 8. Roadmap / ask
  {
    const slide = pptx.addSlide();
    addBg(slide, "FBF8F1");
    addKicker(slide, "Investor-ready next step", 0.65, 0.55, C.gold);
    slide.addText("Turn demo proof into a company operating loop.", {
      x: 0.65,
      y: 1.06,
      w: 7.8,
      h: 0.86,
      fontFace: "Aptos Display",
      fontSize: 29,
      bold: true,
      color: C.ink,
      margin: 0,
      fit: "shrink",
    });
    const roadmap = [
      ["1", "Company memory", "GitHub, Slack, Notion, Linear/Jira, Drive, meetings, and customer artifacts."],
      ["2", "Execution graph", "Durable plans, approvals, retries, trace evidence, and drift checks."],
      ["3", "Trust boundary", "External JAK Shield MCP/API as the policy gate for every high-risk tool call."],
    ];
    roadmap.forEach((row, i) => {
      const y = 2.4 + i * 1.24;
      slide.addText(row[0], {
        x: 0.8,
        y,
        w: 0.42,
        h: 0.42,
        fontFace: "Aptos Display",
        fontSize: 20,
        bold: true,
        color: i === 2 ? C.gold : C.green,
        margin: 0,
      });
      slide.addText(row[1], {
        x: 1.45,
        y: y - 0.02,
        w: 3.1,
        h: 0.3,
        fontFace: "Aptos Display",
        fontSize: 16,
        bold: true,
        color: C.ink,
        margin: 0,
      });
      slide.addText(row[2], {
        x: 1.45,
        y: y + 0.35,
        w: 5.8,
        h: 0.35,
        fontFace: "Aptos",
        fontSize: 9.8,
        color: C.muted,
        margin: 0,
        fit: "shrink",
      });
    });
    slide.addShape(activePptx.ShapeType.roundRect, {
      x: 8.65,
      y: 2.0,
      w: 3.7,
      h: 3.35,
      rectRadius: 0.14,
      fill: { color: C.deep },
      line: { color: C.deep },
    });
    slide.addText("Ask", {
      x: 9.0,
      y: 2.34,
      w: 2.8,
      h: 0.36,
      fontFace: "Aptos Display",
      fontSize: 20,
      bold: true,
      color: C.green,
      margin: 0,
    });
    slide.addText("Design partners who will run one real workflow per week and judge JAK on useful output, approval safety, and audit evidence.", {
      x: 9.0,
      y: 2.96,
      w: 2.95,
      h: 1.26,
      fontFace: "Aptos",
      fontSize: 12,
      color: C.white,
      margin: 0,
      fit: "shrink",
    });
    addMetric(slide, "7 days", "to prove repeat usage", 9.0, 4.72, 1.25);
    addMetric(slide, "1 loop", "per design partner/week", 10.55, 4.72, 1.45);
    addFooter(slide, 8);
  }

  return pptx;
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderPreview(slide, index) {
  const W = 1600;
  const H = 900;
  const bg = slide.bg;
  const dark = slide.dark;
  const titleColor = dark ? "#FFFFFF" : `#${C.ink}`;
  const subtitleColor = dark ? "#BFD2CA" : `#${C.muted}`;
  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
  ];
  if (slide.previewImage) {
    const p = path.join(screenshotDir, slide.previewImage);
    const data = fs.readFileSync(p).toString("base64");
    svgParts.push(`<image href="data:image/png;base64,${data}" x="${slide.previewImageX}" y="${slide.previewImageY}" width="${slide.previewImageW}" height="${slide.previewImageH}" preserveAspectRatio="xMidYMid slice"/>`);
  }
  svgParts.push(`<text x="76" y="90" fill="${slide.kickerColor || `#${C.green}`}" font-family="Arial" font-size="18" font-weight="700" letter-spacing="2">${xmlEscape(slide.kicker || "")}</text>`);
  String(slide.title)
    .split("\n")
    .forEach((line, lineIndex) => {
      svgParts.push(`<text x="76" y="${150 + lineIndex * 58}" fill="${titleColor}" font-family="Arial" font-size="48" font-weight="700">${xmlEscape(line)}</text>`);
    });
  if (slide.subtitle) {
    const subtitleY = 205 + Math.max(0, String(slide.title).split("\n").length - 1) * 58;
    svgParts.push(`<text x="78" y="${subtitleY}" fill="${subtitleColor}" font-family="Arial" font-size="24">${xmlEscape(slide.subtitle)}</text>`);
  }
  (slide.notes || []).forEach((note, i) => {
    svgParts.push(`<circle cx="92" cy="${315 + i * 74}" r="6" fill="#${C.green}"/>`);
    svgParts.push(`<text x="116" y="${325 + i * 74}" fill="${dark ? "#EAF7F1" : `#${C.ink}`}" font-family="Arial" font-size="24">${xmlEscape(note)}</text>`);
  });
  svgParts.push(`<text x="76" y="860" fill="${dark ? "#9DAEA7" : "#86938F"}" font-family="Arial" font-size="13">JAK Swarm pitch deck / ${index}</text>`);
  svgParts.push("</svg>");
  await sharp(Buffer.from(svgParts.join(""))).png().toFile(path.join(previewDir, `slide-${String(index).padStart(2, "0")}.png`));
}

async function renderPreviews() {
  ensureDir(previewDir);
  const previews = [
    {
      bg: `#${C.deep}`,
      dark: true,
      kicker: "INBHARAT AI / JAK SWARM",
      title: "The closed-loop AI operator\nfor founder-led teams",
      subtitle: "Natural-language task -> approved work -> audit evidence",
      previewImage: "07-company-os-landing.png",
      previewImageX: 860,
      previewImageY: 95,
      previewImageW: 650,
      previewImageH: 406,
      notes: ["Real demo capture", "Founder-led team wedge"],
    },
    {
      bg: "#FBF8F1",
      kicker: "PROBLEM",
      kickerColor: `#${C.danger}`,
      title: "AI answers. It still does not safely run company work.",
      subtitle: "Context is scattered, agents are open-loop, and trust breaks at action time.",
      notes: ["Scattered knowledge", "No durable execution", "Approval and audit gaps"],
    },
    {
      bg: "#FFFFFF",
      kicker: "MVP WEDGE",
      title: "Start with workflows founders already run every week.",
      subtitle: "Research, content, code review, and outreach.",
      notes: ["Research", "Content", "Code review", "Outreach"],
    },
    {
      bg: `#${C.deep}`,
      dark: true,
      kicker: "SOLUTION",
      title: "One task becomes\na controlled workflow.",
      subtitle: "Workspace command UI captured from JAK Swarm.",
      previewImage: "01-dashboard-overview.png",
      previewImageX: 655,
      previewImageY: 130,
      previewImageW: 850,
      previewImageH: 531,
      notes: ["Plain-English task entry", "Role-aware routing", "Approval/evidence loop"],
    },
    {
      bg: "#F7FAF8",
      kicker: "HOW IT WORKS",
      title: "How JAK closes the loop.",
      subtitle: "Context -> plan -> route -> execute -> verify -> approve -> audit.",
      previewImage: "02-workflow-planning.png",
      previewImageX: 872,
      previewImageY: 150,
      previewImageW: 636,
      previewImageH: 397,
      notes: ["Durable graph is the next milestone", "Current demo proves the workflow surface"],
    },
    {
      bg: "#071613",
      dark: true,
      kicker: "JAK SHIELD PATH",
      title: "The trust layer sits between\nagents and real-world actions.",
      subtitle: "Approval/audit surface captured from the product demo.",
      previewImage: "03-jak-shield-approval.png",
      previewImageX: 720,
      previewImageY: 126,
      previewImageW: 770,
      previewImageH: 481,
      notes: ["Explicit approval cards", "Payload-bound action target", "External Shield MCP remains separate"],
    },
    {
      bg: "#FFFFFF",
      kicker: "PRODUCT STATUS",
      title: "What already exists in the demo build.",
      subtitle: "Real captured screens, not fake dashboard mockups.",
      previewImage: "06-vibe-builder-generated-proof.png",
      previewImageX: 840,
      previewImageY: 165,
      previewImageW: 610,
      previewImageH: 381,
      notes: ["Role picker", "Vibe Builder", "Audit traces"],
    },
    {
      bg: "#FBF8F1",
      kicker: "INVESTOR-READY NEXT STEP",
      kickerColor: `#${C.gold}`,
      title: "Turn demo proof into a company operating loop.",
      subtitle: "Company memory, durable execution graph, and JAK Shield trust boundary.",
      notes: ["Connect company tools", "Make execution durable", "Gate every risky tool call"],
    },
  ];
  for (let i = 0; i < previews.length; i++) {
    await renderPreview(previews[i], i + 1);
  }
}

function writeMarkdown() {
  const outline = `# JAK Swarm Pitch Deck

Generated from the local JAK Swarm repo using only real screenshots captured during the demo workflow.

## Slide Outline

1. **Cover — The closed-loop AI operator for founder-led teams**
   Screenshot used: \`deck-assets/screenshots/07-company-os-landing.png\`
   Caption: Landing-page proof for the company operating-layer positioning and closed-loop alignment story.

2. **Problem — AI answers, but does not safely run company work**
   No screenshot used. This slide frames the pain: fragmented context, open-loop agents, and trust failure at action time.

3. **MVP Wedge — Founder-led workflows**
   No screenshot used. This slide keeps the wedge narrow: research, content, code review, and outreach.

4. **Solution — One task becomes a controlled workflow**
   Screenshot used: \`deck-assets/screenshots/01-dashboard-overview.png\`
   Caption: JAK Swarm workspace where a founder gives one natural-language task and chooses the specialist role.

5. **How It Works — Context to plan to execution**
   Screenshot used: \`deck-assets/screenshots/02-workflow-planning.png\`
   Caption: Captured workflow proof showing multiple leadership-style agent outputs from the demo run.

6. **JAK Shield Path — Trust layer between agents and tools**
   Screenshot used: \`deck-assets/screenshots/03-jak-shield-approval.png\`
   Caption: Approval inbox surface used as the current protected-action gate; external JAK Shield MCP remains separate.
   Honest note: this is product approval/audit UI proof, not proof of a fully integrated external JAK Shield MCP.

7. **Product Status — What exists now**
   Screenshots used:
   - \`deck-assets/screenshots/05-role-picker-proof.png\`
   - \`deck-assets/screenshots/06-vibe-builder-generated-proof.png\`
   - \`deck-assets/screenshots/04-audit-trail.png\`

8. **Investor-Ready Next Step — Company operating loop**
   No screenshot used. This slide states the build path: company memory, durable execution graph, and JAK Shield trust boundary.

## Truth Rules Applied

- No fake mockups.
- No stock images.
- No generic dashboards.
- Screenshots are copied from actual local JAK Swarm demo/QA captures.
- No API keys, credentials, private emails, or personal tokens were visible in the selected screenshots.
- The deck does not claim that JAK Shield MCP is fully integrated today.
`;

  const reportRows = screenshots
    .map((s) => `| ${s.name} | ${s.slides.join(", ")} | ${s.sourceLabel} | ${s.caption} |`)
    .join("\n");
  const report = `# Pitch Deck Screenshot Asset Report

## Used Assets

| Final asset | Slide(s) | Original capture | Caption |
|---|---:|---|---|
${reportRows}

## QA Notes

- All selected screenshots were generated from local captured JAK Swarm demo or Playwright QA artifacts.
- Final copies were saved under \`deck-assets/screenshots\`.
- Images were resized consistently to 1440x900 and rounded with transparent corners for clean deck placement.
- No selected screenshot contained visible API keys, tokens, private emails, credentials, or personal data.
- Slide 6 is intentionally labeled as the JAK Shield path/trust boundary. The screenshot proves the current approval surface, not a completed external JAK Shield MCP integration.
`;

  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, "jak-swarm-pitch-deck.md"), outline);
  fs.writeFileSync(path.join(outputDir, "deck-asset-report.md"), report);
}

async function main() {
  ensureDir(outputDir);
  await prepareScreenshots();
  const pptx = buildDeck();
  const pptxPath = path.join(outputDir, "jak-swarm-pitch-deck.pptx");
  await pptx.writeFile({ fileName: pptxPath });
  writeMarkdown();
  await renderPreviews();
  console.log(`PPTX: ${pptxPath}`);
  console.log(`Outline: ${path.join(outputDir, "jak-swarm-pitch-deck.md")}`);
  console.log(`Asset report: ${path.join(outputDir, "deck-asset-report.md")}`);
  console.log(`Previews: ${previewDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
