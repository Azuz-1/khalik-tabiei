import { test, expect } from "@playwright/test";

test("shared links unfurl with an absolute Arabic preview image", async ({ request }) => {
  for (const path of ["/", "/join/ABCDE"]) {
    const page = await request.get(path);
    expect(page.status()).toBe(200);
    expect(page.headers()["cache-control"]).toBe("no-cache");
    const html = await page.text();
    expect(html).not.toContain("__PUBLIC_ORIGIN__");
    expect(html).toContain('<meta property="og:image" content="http://127.0.0.1:8080/og.jpg"');
    expect(html).toContain('<meta property="og:locale" content="ar_SA"');
  }
  const image = await request.get("/og.jpg");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
  expect((await image.body()).length).toBeLessThan(300_000);

  const direct = await request.get("/index.html", { maxRedirects: 0 });
  expect(direct.status()).toBe(301);
  expect(direct.headers().location).toBe("/");
});
