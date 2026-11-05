// Synthetic browser acceptance. All accounts, room events and audio bytes are fixtures.
// This verifies UI/state recovery, not two-device synchronization or provider media quality.
const { chromium } = require("playwright");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve("dist"), shots = path.resolve("test-results/rooms");
fs.mkdirSync(shots, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403); response.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  response.setHeader("content-type", ({ ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".css": "text/css", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(response);
});
function audioFixture() {
  const rate = 8000, frames = rate * 2, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  return bytes;
}
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce", timezoneId: "UTC" });
  const page = await context.newPage(), errors = [], sockets = new Set(), allSockets = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  const user = { id: "qa-room-owner", name: "Alex", email: "room-owner@example.test", email_verified: true, onboarding_complete: true };
  const sister = { id: "qa-room-member", name: "Sam", email_verified: true, onboarding_complete: true };
  let room = {
    id: "synthetic-room", name: "Evening tea", creator_id: user.id, members: [user.id, sister.id], member_users: [user, sister],
    presence: { [user.id]: new Date().toISOString(), [sister.id]: new Date().toISOString() }, active_members: [user.id, sister.id],
    mode: "idle", content: null, version: 1, server_time: new Date().toISOString(),
    state: { host_id: user.id, is_playing: false, position_sec: 0, version: 1, session_id: "activity-one", updated_at: new Date().toISOString(), server_time: new Date().toISOString() },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const clone = value => JSON.parse(JSON.stringify(value)), messages = [], sentIds = [], wav = audioFixture();
  let upload = null, binaryUploads = 0, mediaRequests = 0, missingRequests = 0, firstAckLost = true, createdMembers = null;
  const stamp = () => new Date().toISOString();
  const snapshot = () => ({ ...clone(room), server_time: stamp(), state: { ...clone(room.state), server_time: stamp() } });
  function emit(event) { for (const socket of sockets) socket.send(JSON.stringify(event)); }
  function updateState(patch) {
    room.version++; room.state = { ...room.state, ...patch, version: room.version, updated_at: stamp(), server_time: stamp() };
    room.updated_at = stamp(); room.server_time = stamp();
  }
  await context.addInitScript(user => { localStorage.setItem("kuku_profile", JSON.stringify(user)); localStorage.setItem("kuku_appearance_v1", JSON.stringify({ mode: "light", dayTheme: "warm", nightTheme: "evening", dayAt: "07:00", nightAt: "19:00", decor: "plain" })); }, user);
  await page.routeWebSocket(/.*/, socket => {
    if (!socket.url().includes("/ws/spaces/")) { socket.onMessage(() => {}); return; }
    sockets.add(socket); allSockets.push(socket);
    socket.onClose(() => { sockets.delete(socket); });
    socket.onMessage(raw => {
      const event = JSON.parse(String(raw));
      if (event.type === "ping") socket.send(JSON.stringify({ type: "pong", client_time: event.client_time, server_time: stamp() }));
    });
    socket.send(JSON.stringify({ type: "snapshot", space: snapshot() }));
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const body = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() || {} : {};
    const respond = (status, value) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store", "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" }, body: JSON.stringify(value) });
    if (request.method() === "OPTIONS") return respond(200, {});
    if (endpoint === "/api/auth/refresh") return respond(200, { token: "synthetic-room-token", user });
    if (endpoint === "/api/auth/me") return respond(200, user);
    if (endpoint === "/api/auth/ws-ticket") return respond(200, { ticket: "synthetic-room-ticket" });
    if (endpoint === "/api/users") return respond(200, [sister]);
    if (endpoint === "/api/chats") return respond(200, []);
    if (endpoint === "/api/files/status") return respond(200, { available: true, used_bytes: 0, remaining_bytes: 10000000, max_file_bytes: 10000000 });
    if (endpoint === "/api/spaces" && request.method() === "GET") return respond(200, { active: [snapshot()], saved: [snapshot()] });
    if (endpoint === "/api/spaces" && request.method() === "POST") { createdMembers = body.member_ids; room.name = body.name || "Evening tea"; return respond(200, snapshot()); }
    if (endpoint.startsWith("/api/spaces/missing-room")) { missingRequests++; return respond(404, { detail: "Space not found" }); }
    if (endpoint === "/api/spaces/synthetic-room") return respond(200, snapshot());
    if (endpoint.endsWith("/synthetic-room/join")) { assert.ok(body.connection_id, "Room joins use a per-mounted connection ID"); return respond(200, snapshot()); }
    if (endpoint.endsWith("/synthetic-room/leave")) return respond(200, { ok: true });
    if (endpoint.endsWith("/synthetic-room/host")) {
      assert.ok(room.active_members.includes(body.user_id)); updateState({ host_id: body.user_id });
      emit({ type: "state", state: clone(room.state), version: room.version, server_time: stamp() });
      return respond(200, clone(room.state));
    }
    if (endpoint.endsWith("/synthetic-room/state")) {
      assert.equal(room.state.host_id, user.id);
      if (body.expected_version !== room.version) return respond(409, { detail: "Playback changed. Refresh and try again." });
      updateState({ is_playing: body.is_playing, position_sec: body.position_sec });
      emit({ type: "state", state: clone(room.state), version: room.version, server_time: stamp() });
      return respond(200, clone(room.state));
    }
    if (endpoint.endsWith("/synthetic-room/messages") && request.method() === "GET") {
      let selected = messages;
      if (url.searchParams.get("after")) { const index = messages.findIndex(message => message.id === url.searchParams.get("after")); selected = index < 0 ? [] : messages.slice(index + 1); }
      if (url.searchParams.get("before")) { const index = messages.findIndex(message => message.id === url.searchParams.get("before")); selected = index < 0 ? [] : messages.slice(0, index); }
      return respond(200, selected.slice(-50));
    }
    if (endpoint.endsWith("/synthetic-room/messages") && request.method() === "POST") {
      assert.ok(body.client_message_id, "Room draft sends have an idempotency key"); sentIds.push(body.client_message_id);
      let message = messages.find(item => item.client_message_id === body.client_message_id);
      if (!message) { message = { id: "room-message-" + messages.length, space_id: room.id, sender_id: user.id, sender_name: user.name, text: body.text, client_message_id: body.client_message_id, created_at: stamp() }; messages.push(message); emit({ type: "message", message }); }
      if (firstAckLost) { firstAckLost = false; return respond(503, { detail: "Confirmation interrupted. Your draft is kept." }); }
      return respond(200, message);
    }
    if (endpoint === "/api/audio/library") return respond(200, []);
    if (endpoint === "/api/audio/uploads" && request.method() === "GET") return respond(200, upload ? [upload] : []);
    if (endpoint === "/api/audio/uploads/binary") {
      binaryUploads++; assert.deepEqual(request.postDataBuffer(), wav, "Upload sends the exact raw WAV bytes");
      upload = { id: "synthetic-audio", title: "Family tune", uploader_id: user.id, uploader_name: user.name, duration_sec: 2, created_at: stamp() };
      return respond(200, upload);
    }
    if (endpoint.endsWith("/synthetic-room/content")) {
      assert.equal(body.upload_id, "synthetic-audio");
      room.content = { type: "audio", source: "upload", upload_id: upload.id, title: upload.title, duration_sec: 2 };
      room.mode = "audio"; updateState({ is_playing: true, position_sec: 0, session_id: "activity-audio" });
      emit({ type: "content", content: clone(room.content), mode: room.mode, state: clone(room.state) });
      return respond(200, { ok: true, content: clone(room.content), state: clone(room.state) });
    }
    if (endpoint === "/api/audio/uploads/synthetic-audio/download") return respond(200, { url: origin + "/api/audio/uploads/synthetic-audio/stream?ticket=synthetic-stream", media_type: "audio/wav", expires_in: 60 });
    if (endpoint === "/api/audio/uploads/synthetic-audio/stream") { mediaRequests++; return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "cache-control": "no-store", "accept-ranges": "bytes" }, body: wav }); }
    if (endpoint.endsWith("/reactions")) return respond(200, { ok: true });
    return respond(200, []);
  });
  try {
    await page.goto(origin + "/space/synthetic-room");
    await page.getByText("A little place, together.", { exact: true }).waitFor();
    await page.getByText("You're hosting", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("space-add-content").isEnabled(), true);
    assert.equal(await page.getByTestId("space-play-toggle").isDisabled(), true, "No transport without content");

    await page.getByTestId("space-chat-btn").click();
    await page.getByTestId("space-chat-input").fill("Tea in the room");
    await page.getByTestId("space-chat-send").click();
    await page.getByRole("alert").filter({ hasText: "Confirmation interrupted" }).waitFor();
    assert.equal(await page.getByTestId("space-chat-input").inputValue(), "Tea in the room");
    await page.getByTestId("space-chat-send").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="space-chat-input"]')?.value === "");
    assert.equal(sentIds.length, 2); assert.equal(sentIds[0], sentIds[1], "Failed draft retry reuses its key");
    assert.equal(await page.getByText("Tea in the room", { exact: true }).count(), 1, "HTTP and socket delivery merge once");
    await page.screenshot({ path: path.join(shots, "room-chat-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Close panel", exact: true }).last().click();

    await page.getByRole("button", { name: "View room members and hosting", exact: true }).click();
    await page.getByRole("button", { name: "Pass host", exact: true }).click();
    await page.getByRole("button", { name: "Close panel", exact: true }).last().click();
    await page.getByText("Sam is hosting", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("space-add-content").isDisabled(), true);
    assert.equal(await page.getByTestId("space-play-toggle").isDisabled(), true);
    await page.screenshot({ path: path.join(shots, "member-room-390.png"), fullPage: true });

    await page.getByRole("button", { name: "View room members and hosting", exact: true }).click();
    await page.getByRole("button", { name: "Host", exact: true }).click();
    await page.getByRole("button", { name: "Close panel", exact: true }).last().click();
    await page.getByText("You're hosting", { exact: true }).waitFor();
    const stale = snapshot(); stale.version--; stale.state.version--; stale.state.host_id = sister.id;
    emit({ type: "snapshot", space: stale }); await page.waitForTimeout(150);
    assert.equal(await page.getByText("You're hosting", { exact: true }).count(), 1, "A stale snapshot cannot roll host ownership back");

    updateState({ host_id: sister.id });
    for (const socket of [...sockets]) { sockets.delete(socket); await socket.close({ code: 1012, reason: "Synthetic restart" }); }
    await page.getByTestId("space-connection").getByText("Reconnecting", { exact: false }).waitFor();
    await page.getByText("Sam is hosting", { exact: true }).waitFor();
    await page.getByTestId("space-connection").getByText("Room connected", { exact: true }).waitFor();
    assert.ok(allSockets.length >= 2, "Room reconnect obtains another socket");
    updateState({ host_id: user.id }); emit({ type: "snapshot", space: snapshot() });
    await page.getByText("You're hosting", { exact: true }).waitFor();

    await page.getByTestId("space-add-content").click();
    await page.getByTestId("add-tab-audio").click();
    const chooser = page.waitForEvent("filechooser"); await page.getByTestId("audio-upload-btn").click();
    await (await chooser).setFiles({ name: "family.wav", mimeType: "audio/wav", buffer: wav });
    await page.getByTestId("upload-synthetic-audio").waitFor();
    await page.getByTestId("upload-synthetic-audio").click();
    await page.getByText("Set the mood", { exact: true }).locator("..").getByRole("button", { name: "Close panel", exact: true, includeHidden: true }).waitFor({ state: "hidden" });
    await page.getByTestId("add-tab-audio").waitFor({ state: "hidden" });
    await page.getByText("Family tune", { exact: true }).waitFor();
    await page.getByText(/^(Listening together|Track finished)$/).waitFor();
    assert.equal(binaryUploads, 1); assert.ok(mediaRequests > 0, "A private media reference resolves to a fixture stream");
    assert.equal(room.content.url, undefined, "Room snapshots do not carry private audio bytes or provider URLs");

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(80);
      assert.equal(await page.locator("html").evaluate(element => element.scrollWidth), width, "Room has no horizontal overflow at " + width);
      await page.screenshot({ path: path.join(shots, "audio-room-" + width + ".png"), fullPage: true });
    }
    await page.goto(origin + "/spaces");
    await page.getByTestId("room-row-synthetic-room").waitFor();
    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(await page.locator("html").evaluate(element => element.scrollWidth), 320, "Spaces list fits 320px");
    await page.screenshot({ path: path.join(shots, "spaces-320.png"), fullPage: true });

    await page.getByTestId("create-space-button").click();
    await page.getByTestId("space-name-input").fill("Evening tea");
    await page.getByTestId("pick-qa-room-member").click();
    const creationResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/spaces");
    await page.getByTestId("create-space-submit").click();
    assert.equal((await (await creationResponse).json()).id, "synthetic-room", "Creation returns the room that navigation opens");
    await page.waitForURL(url => url.pathname === "/space/synthetic-room");
    // Stack navigation may retain an aria-hidden previous room/list in the DOM.
    // A role locator excludes inactive routes; its control row's parent is this room.
    const currentRoom = page.getByRole("button", { name: "Choose room activity", exact: true }).locator("..").locator("..");
    await currentRoom.getByText("Family tune", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await currentRoom.getByText("Family tune", { exact: true }).count(), 1, "The active created room renders its selected media once");
    await currentRoom.getByText("You're hosting", { exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(createdMembers, [sister.id]);

    await page.goto(origin + "/space/missing-room");
    await page.getByRole("alert").filter({ hasText: "This room is no longer available." }).waitFor();
    const beforeRetry = missingRequests;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "This room is no longer available." }).waitFor();
    assert.ok(missingRequests > beforeRetry, "Missing-room retry dispatches a new bounded attempt");
    await page.screenshot({ path: path.join(shots, "missing-room-320.png"), fullPage: true });
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log("Synthetic Spaces acceptance passed: private room UI, exact raw upload and fixture playback, scoped join, host handoff, idempotent draft retry, stale-state rejection, reconnect, missing-room retry and responsive 320/390/768/1440px layouts. Not real-device synchronization evidence.");
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png"), fullPage: true }).catch(() => {});
    console.error("Rooms failure context:", JSON.stringify({ url: page.url(), body: (await page.locator("body").innerText()).slice(-2500), roomVersion: room.version, socketCount: allSockets.length, errors }));
    throw error;
  } finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
