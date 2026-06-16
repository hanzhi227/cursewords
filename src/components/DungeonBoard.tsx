import { memo, useMemo } from "react";
import type { PlayerView, RoomCard, TeamId } from "../shared/types";
import gatehouseUrl from "../assets/rooms/gatehouse.svg";
import mossStepsUrl from "../assets/rooms/moss-steps.svg";
import inkWellUrl from "../assets/rooms/ink-well.svg";
import mimicHallUrl from "../assets/rooms/mimic-hall.svg";
import moonVaultUrl from "../assets/rooms/moon-vault.svg";
import candleCryptUrl from "../assets/rooms/candle-crypt.svg";
import bossDoorUrl from "../assets/rooms/boss-door.svg";
import emberPawnUrl from "../assets/pawns/ember-pawn.svg";
import frostPawnUrl from "../assets/pawns/frost-pawn.svg";

const ROOM_ART: Record<string, string> = {
  gatehouse: gatehouseUrl,
  "moss-steps": mossStepsUrl,
  "ink-well": inkWellUrl,
  "mimic-hall": mimicHallUrl,
  "moon-vault": moonVaultUrl,
  "candle-crypt": candleCryptUrl,
  "boss-door": bossDoorUrl
};

const PAWN_ART: Record<TeamId, string> = {
  ember: emberPawnUrl,
  frost: frostPawnUrl
};

const TEAM_NAME: Record<TeamId, string> = {
  ember: "Ember Guild",
  frost: "Frost Order"
};

const ROOM_AREAS = ["room-a", "room-b", "room-c", "room-d", "room-e", "room-f", "room-g"];

export const DungeonBoard = memo(function DungeonBoard({ view }: { view: PlayerView }) {
  const { state } = view;
  const activeTeam = state.round?.activeTeam ?? state.round?.nextTeam;
  const spotlightIndex = activeTeam ? state.teams[activeTeam].progress : Math.max(state.teams.ember.progress, state.teams.frost.progress);
  const spotlightRoom = state.rooms[Math.min(spotlightIndex, state.rooms.length - 1)];
  const longBoard = state.rooms.length > ROOM_AREAS.length;
  const emberProgress = state.teams.ember.progress;
  const frostProgress = state.teams.frost.progress;
  const roomCount = state.rooms.length;

  return (
    <section className={`panel dungeon-board-panel ${longBoard ? "long-board" : ""}`}>
      <div className="board-header">
        <div>
          <p className="eyebrow">Dungeon board</p>
          <h2>{spotlightRoom?.title ?? "The Dungeon"}</h2>
          <p>{spotlightRoom?.subtitle ?? "Race through the rooms without tripping the traps."}</p>
        </div>
        <div className="board-round-badge">
          <span>Round</span>
          <strong>{state.round?.index ?? 0}</strong>
        </div>
      </div>

      <div className="dungeon-board-stage">
        {!longBoard && (
          <svg className="dungeon-path-lines" viewBox="0 0 1000 500" aria-hidden="true">
            <path className="path-shadow" d="M92 104 C226 34 303 64 388 121 S579 205 686 140 S848 71 929 119" />
            <path className="path-shadow" d="M929 119 C826 220 705 228 604 258 S386 291 291 364 S132 439 76 365" />
            <path className="path-main" d="M92 104 C226 34 303 64 388 121 S579 205 686 140 S848 71 929 119" />
            <path className="path-main" d="M929 119 C826 220 705 228 604 258 S386 291 291 364 S132 439 76 365" />
          </svg>
        )}
        <div className="dungeon-board-grid">
          {state.rooms.map((room, index) => (
            <RoomArtCard
              key={room.id}
              room={room}
              index={index}
              area={longBoard ? undefined : ROOM_AREAS[index]}
              emberProgress={emberProgress}
              frostProgress={frostProgress}
              activeTeam={activeTeam}
              isBoss={index === state.rooms.length - 1}
            />
          ))}
        </div>
      </div>

      <div className="board-footer">
        <TeamJourney team="ember" progress={emberProgress} roomCount={roomCount} />
        <TeamJourney team="frost" progress={frostProgress} roomCount={roomCount} />
      </div>
    </section>
  );
});

const RoomArtCard = memo(function RoomArtCard({
  room,
  index,
  area,
  emberProgress,
  frostProgress,
  activeTeam,
  isBoss
}: {
  room: RoomCard;
  index: number;
  area?: string;
  emberProgress: number;
  frostProgress: number;
  activeTeam?: TeamId;
  isBoss: boolean;
}) {
  const gridStyle = useMemo(() => (area ? { gridArea: area } : undefined), [area]);
  const pawns = (["ember", "frost"] as TeamId[]).filter((team) => (team === "ember" ? emberProgress : frostProgress) === index);
  const clearedBy = (["ember", "frost"] as TeamId[]).filter((team) => (team === "ember" ? emberProgress : frostProgress) > index);
  const locked = emberProgress < index && frostProgress < index;
  const active = Boolean(activeTeam && (activeTeam === "ember" ? emberProgress : frostProgress) === index);
  const status = locked ? "locked" : active ? "active" : clearedBy.length > 0 ? "cleared" : "open";

  return (
    <article className={`dungeon-room-card ${status} ${isBoss ? "boss-room" : ""}`} style={gridStyle}>
      <div className="room-art-frame">
        <img src={ROOM_ART[room.id] ?? gatehouseUrl} alt={room.title} />
        <div className="room-number">{index + 1}</div>
        <div className="room-trap-count">{room.trapCount} traps</div>
        <div className="pawn-dock">
          {pawns.map((team) => (
            <img className={`team-pawn ${team}`} src={PAWN_ART[team]} alt={`${TEAM_NAME[team]} pawn`} key={team} />
          ))}
        </div>
      </div>
      <div className="room-card-copy">
        <div>
          <h3>{room.title}</h3>
          <p>{room.curse}</p>
        </div>
        <div className="room-status-row">
          {clearedBy.map((team) => <span className={`status-chip ${team}`} key={team}>{TEAM_NAME[team]} cleared</span>)}
          {locked && <span className="status-chip locked">Locked</span>}
          {active && activeTeam && <span className={`status-chip ${activeTeam}`}>{TEAM_NAME[activeTeam]} here</span>}
        </div>
      </div>
    </article>
  );
});

const TeamJourney = memo(function TeamJourney({ team, progress, roomCount }: { team: TeamId; progress: number; roomCount: number }) {
  const percent = Math.min(100, Math.round((progress / roomCount) * 100));
  const meterStyle = useMemo(() => ({ width: `${percent}%` }), [percent]);
  return (
    <div className={`team-journey ${team}`}>
      <img src={PAWN_ART[team]} alt="" />
      <div>
        <span>{TEAM_NAME[team]}</span>
        <div className="journey-meter"><i style={meterStyle} /></div>
      </div>
      <strong>{progress}/{roomCount}</strong>
    </div>
  );
});
