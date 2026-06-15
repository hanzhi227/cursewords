import { describe, expect, it } from "vitest";
import { GameEngine } from "./engine";

describe("GameEngine", () => {
  it("keeps target words private during trap writing", () => {
    const engine = new GameEngine();
    engine.joinPlayer("host", "Host", true);
    engine.joinPlayer("guest", "Guest", false);
    engine.chooseTeam("host", "ember");
    engine.chooseTeam("guest", "frost");
    engine.startGame("host");

    const hostView = engine.getView("host");
    const guestView = engine.getView("guest");

    expect(hostView.state.round?.reveal).toBeUndefined();
    expect(hostView.private.writingForTeam).toBe("frost");
    expect(guestView.private.writingForTeam).toBe("ember");
    expect(hostView.private.visibleTarget).not.toBe(guestView.private.visibleTarget);
  });

  it("advances a team on a correct clue", () => {
    const engine = new GameEngine({ timeLimitSec: 5 });
    engine.joinPlayer("host", "Host", true);
    engine.joinPlayer("guest", "Guest", false);
    engine.chooseTeam("host", "ember");
    engine.chooseTeam("guest", "frost");
    engine.startGame("host");

    const round = engine.snapshot().round!;
    engine.submitTraps("host", Array.from({ length: round.trapLimitForTeam.frost }, (_, index) => `ember trap ${index}`));
    engine.submitTraps("guest", Array.from({ length: round.trapLimitForTeam.ember }, (_, index) => `frost trap ${index}`));

    const nextTeam = engine.snapshot().round!.nextTeam!;
    engine.beginClue("host", nextTeam);
    engine.resolveAttempt(nextTeam === "ember" ? "host" : "guest", "correct");

    expect(engine.snapshot().teams[nextTeam].progress).toBe(1);
  });

  it("uses host-provided custom words in custom-only mode", () => {
    const engine = new GameEngine();
    engine.joinPlayer("host", "Host", true);
    engine.joinPlayer("guest", "Guest", false);
    engine.chooseTeam("host", "ember");
    engine.chooseTeam("guest", "frost");
    engine.startGame("host", {
      wordSource: "custom",
      customWords: ["Moon Banana", "Glass Trombone"]
    });

    const hostTarget = engine.getView("host").private.visibleTarget;
    const guestTarget = engine.getView("guest").private.visibleTarget;

    expect([hostTarget, guestTarget].sort()).toEqual(["Glass Trombone", "Moon Banana"]);
    expect(engine.snapshot().settings.customWordCount).toBe(2);
    expect(engine.snapshot().settings.wordSource).toBe("custom");
  });

  it("shares trap drafts with teammates but not opponents", () => {
    const engine = new GameEngine();
    engine.joinPlayer("host", "Host", true);
    engine.joinPlayer("ally", "Ally", false);
    engine.joinPlayer("guest", "Guest", false);
    engine.chooseTeam("host", "ember");
    engine.chooseTeam("ally", "ember");
    engine.chooseTeam("guest", "frost");
    engine.startGame("host");

    engine.setTrapDraft("host", ["obvious", "synonym"]);

    expect(engine.getView("host").private.draftTraps).toEqual(["obvious", "synonym"]);
    expect(engine.getView("ally").private.draftTraps).toEqual(["obvious", "synonym"]);
    expect(engine.getView("guest").private.draftTraps).toEqual([]);
    expect(engine.snapshot().round?.reveal).toBeUndefined();
  });

  it("seals the shared draft and blocks later edits", () => {
    const engine = new GameEngine();
    engine.joinPlayer("host", "Host", true);
    engine.joinPlayer("guest", "Guest", false);
    engine.chooseTeam("host", "ember");
    engine.chooseTeam("guest", "frost");
    engine.startGame("host");

    const limit = engine.snapshot().round!.trapLimitForTeam.frost;
    const traps = Array.from({ length: limit }, (_, index) => `draft trap ${index}`);
    engine.setTrapDraft("host", traps);
    engine.submitTraps("host", []);

    expect(engine.getView("host").private.submittedTraps).toEqual(traps);
    expect(() => engine.setTrapDraft("host", ["late trap"])).toThrow("already sealed");
  });
});
