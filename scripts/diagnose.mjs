import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

page.on("console", (msg) => console.log(`[console:${msg.type()}]`, msg.text()));
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), req.failure()?.errorText));

await page.goto("http://127.0.0.1:43117", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const before = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[data-slot="tabs-trigger"]')];
  return {
    tabCount: tabs.length,
    tabs: tabs.map((t) => ({
      text: t.textContent,
      dataActive: t.getAttribute("data-active"),
      ariaSelected: t.getAttribute("aria-selected"),
      disabled: t.hasAttribute("disabled") || t.getAttribute("aria-disabled"),
      pointerEvents: getComputedStyle(t).pointerEvents,
      rect: t.getBoundingClientRect().toJSON(),
    })),
    buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean),
  };
});
console.log("BEFORE:", JSON.stringify(before, null, 2));

// Click the Simulator tab by text.
const clicked = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-slot="tabs-trigger"]')].find((t) =>
    t.textContent?.includes("Simulator"),
  );
  if (!tab) return "not found";
  tab.click();
  return "clicked";
});
console.log("CLICK RESULT:", clicked);

await new Promise((r) => setTimeout(r, 1500));

const after = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => ({
    text: t.textContent,
    dataActive: t.getAttribute("data-active"),
    ariaSelected: t.getAttribute("aria-selected"),
  })),
  buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean),
}));
console.log("AFTER JS CLICK:", JSON.stringify(after, null, 2));

// Try a real mouse click at the element's centre.
const box = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-slot="tabs-trigger"]')].find((t) =>
    t.textContent?.includes("Simulator"),
  );
  const r = tab.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(box.x, box.y);
await new Promise((r) => setTimeout(r, 1500));

const afterMouse = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => ({
    text: t.textContent,
    dataActive: t.getAttribute("data-active"),
  })),
  buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean),
}));
console.log("AFTER MOUSE CLICK:", JSON.stringify(afterMouse, null, 2));

await browser.close();
