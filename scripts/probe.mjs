import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("WebSocket")) {
    console.log("[console:error]", msg.text());
  }
});

await page.goto("http://127.0.0.1:43219/probe", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const headings = () => page.$$eval("h2", (els) => els.map((e) => e.textContent));
console.log("INITIAL:", await headings());

async function clickText(text) {
  const handle = await page.evaluateHandle((t) => {
    return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) ?? null;
  }, text);
  const element = handle.asElement();
  if (!element) {
    console.log(`  !! no button "${text}"`);
    return;
  }
  await element.click();
  await new Promise((r) => setTimeout(r, 400));
}

for (const label of ["B", "rawB", "uncB", "bump"]) {
  await clickText(label);
  console.log(`AFTER click "${label}":`, await headings());
}

// Slider via keyboard.
await page.focus('[data-slot="slider-thumb"]');
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await new Promise((r) => setTimeout(r, 400));
console.log("AFTER slider arrows:", await headings());

// Switch.
await clickText("");
const switchEl = await page.$('[data-slot="switch"], button[role="switch"]');
if (switchEl) {
  await switchEl.click();
  await new Promise((r) => setTimeout(r, 400));
}
console.log("AFTER switch click:", await headings());

await browser.close();
