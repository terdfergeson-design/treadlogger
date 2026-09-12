import puppeteer from "puppeteer-core";

const headlessMode = process.argv[2] === "new" ? true : "shell";
console.log("headless mode:", headlessMode);

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: headlessMode,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", error.message, error.stack?.slice(0, 400)));
page.on("console", (msg) => console.log(`[console:${msg.type()}]`, msg.text().slice(0, 300)));
page.on("requestfailed", (req) =>
  console.log("[requestfailed]", req.url().slice(-70), req.failure()?.errorText),
);
page.on("response", (res) => {
  if (res.status() >= 400) console.log("[http]", res.status(), res.url().slice(-90));
});

await page.goto("http://127.0.0.1:43117/probe", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));

const info = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "bump");
  const fiberKey = button ? Object.keys(button).find((k) => k.startsWith("__react")) : null;
  return {
    scriptCount: document.querySelectorAll("script[src]").length,
    scriptSrcs: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")?.slice(-60)),
    hasButton: Boolean(button),
    reactFiberKeyOnButton: fiberKey ?? null,
    reactGlobals: Object.keys(window).filter((k) => /react|__next|turbopack/i.test(k)).slice(0, 20),
    bodyChildCount: document.body.childElementCount,
  };
});
console.log("INFO:", JSON.stringify(info, null, 2));

await browser.close();
