import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

/**
 * Mic permission is hard to grant from Playwright without browser flags
 * (`--use-fake-ui-for-media-stream`), so we test the UI flow up to (but not
 * across) the getUserMedia call. Real-device behavior is verified by humans.
 */
test("role switch toggles between student and teacher views", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByRole("button", { name: /arm mic/i })).toBeVisible();
  await page.getByRole("button", { name: /teacher/i }).click();
  await expect(page.getByText(/class avg/)).toBeVisible();
  await expect(page.getByText(/no mics yet/i)).toBeVisible();
});

/**
 * Load-bearing cross-peer assertion: the advertised core action is "a student's
 * noise level shows up on the teacher's class noise map in real time". A real
 * mic cannot be driven headless, so peer A (student) uses the manual-level
 * fallback to broadcast a level; peer B (teacher) must reflect it on the class
 * map (per-peer row AND the class average). This fails on the old code, which
 * had no headless-drivable level source at all.
 */
test("student peer A's noise level propagates to teacher peer B's class map", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    // Peer B becomes the teacher (monitor) and starts on an empty map.
    await b.getByRole("button", { name: /teacher/i }).click();
    await expect(b.getByText(/no mics yet/i)).toBeVisible();

    // Peer A is a named student who arms and dials in a concrete noise level.
    await a.getByPlaceholder("your name (optional)").fill("alice");
    await a.getByRole("button", { name: /arm mic/i }).click();
    const slider = a.getByLabel("manual noise level");
    await expect(slider).toBeVisible();
    await slider.fill("72");

    // Teacher's map now shows alice with her exact level, and the class avg
    // (one armed mic) equals that level — the value crossed the mesh.
    const aliceRow = b.locator(".shhh-peer", { hasText: "alice" });
    await expect(aliceRow).toBeVisible();
    await expect(aliceRow.locator(".shhh-peer-val")).toHaveText("72");
    await expect(b.getByText(/class avg:/)).toContainText("72");
    await expect(b.getByText(/1 mic armed/)).toBeVisible();

    // Calm down: drop the level and confirm the teacher's map tracks it down.
    await slider.fill("8");
    await expect(aliceRow.locator(".shhh-peer-val")).toHaveText("8");
    await expect(b.getByText(/class avg:/)).toContainText("8");

    // Disarm: alice leaves the map on peer B (the reading is cleared mesh-wide).
    await a.getByRole("button", { name: /disarm/i }).click();
    await expect(b.getByText(/no mics yet/i)).toBeVisible();
  } finally {
    await cleanup();
  }
});
