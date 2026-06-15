import { io } from "socket.io-client";

const endpoint = process.env.SERVER_URL ?? "http://127.0.0.1:4949";
const playPassword = (process.env.CURSEWORDS_PLAY_PASSWORD ?? process.env.PLAY_PASSWORD ?? "").trim();

async function waitForConnect(socket) {
  if (socket.connected) return;
  await new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (error) => reject(error));
  });
}

async function main() {
  const socketOptions = {
    auth: playPassword ? { playPassword } : {},
    transports: ["websocket"]
  };

  const host = io(endpoint, socketOptions);
  await waitForConnect(host);

  let hostView = null;
  host.on("view", (view) => {
    hostView = view;
  });

  const room = await new Promise((resolve, reject) => {
    host.emit("createRoom", { name: "Host" }, (result) => {
      if (result.roomCode && result.hostToken) {
        resolve({ roomCode: result.roomCode, hostToken: result.hostToken });
        return;
      }
      reject(new Error(result.error ?? "createRoom failed"));
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!hostView) throw new Error("Host did not receive a view after createRoom");

  const guest = io(endpoint, socketOptions);
  await waitForConnect(guest);

  let guestView = null;
  guest.on("view", (view) => {
    guestView = view;
  });

  await new Promise((resolve, reject) => {
    guest.emit("joinRoom", { roomCode: room.roomCode, name: "Guest" }, (result) => {
      if (result.ok) resolve();
      else reject(new Error(result.error ?? "joinRoom failed"));
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!guestView) throw new Error("Guest did not receive a view after joinRoom");

  host.disconnect();
  guest.disconnect();
  console.log(`Smoke test passed for room ${room.roomCode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
