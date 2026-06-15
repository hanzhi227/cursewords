export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(value?: string) {
  const code = (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === ROOM_CODE_LENGTH ? code : "";
}
