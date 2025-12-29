import { useEffect, useMemo, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any };
type ProtectionResult = "none" | "success" | "partial";

type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
  revealedHunterNames?: string[];
  revealed: {
    killedExists: boolean;
    killedPlayerIds: string[];
    protectionAttempted: boolean;
    protectionResult: ProtectionResult;
  };
  players: PublicPlayer[];
};

type Me = {
  playerId: string;
  name: string;
  alive: any; // true/false/"unknown"
  roleRevealed: any;
  role: "king" | "hunter" | "animal";
  knownHunter: null | { playerId: string; name: string };
  knownOtherHunter: null | { playerId: string; name: string };
  didHunt: boolean;
  didProtect: boolean;
  didVote1: boolean;
  didVote2: boolean;
};

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function phaseCanKnowAlive(phase: string) {
  return (
    phase === "hikeEnd" ||
    phase === "vote1Intro" ||
    phase === "vote1" ||
    phase === "vote2Intro" ||
    phase === "vote2" ||
    phase === "endedHunters" ||
    phase === "endedAnimals"
  );
}

function roleLabel(role: Me["role"]) {
  if (role === "king") return "동물의 왕";
  if (role === "hunter") return "동물의 탈을 쓴 사냥꾼";
  return "동물친구들";
}

function protectionAttemptText(attempted: boolean) {
  return attempted ? "시도함" : "시도 안함";
}

function protectionResultText(attempted: boolean, result: ProtectionResult) {
  if (!attempted) return "해당 없음";
  if (result === "success") return "성공";
  if (result === "partial") return "일부 성공";
  return "실패";
}

function phaseLabel(phase: string) {
  // ✅ 요청한 한글 흐름: 대기 > 등산시작 > 등산종료 > 1차투표 > 2차투표 > 최종결과 확인
  switch (phase) {
    case "lobby":
      return "대기";
    case "hike":
      return "등산시작";
    case "hikeEnd":
      return "등산종료";
    case "vote1Intro":
    case "vote1":
      return "1차투표";
    case "vote2Intro":
    case "vote2":
      return "2차투표";
    case "endedHunters":
    case "endedAnimals":
      return "최종결과 확인";
    default:
      return phase;
  }
}

function winnerLabelByPhaseOrField(phase: string, endedWinner: string) {
  if (phase === "endedHunters") return "사냥꾼 승리";
  if (phase === "endedAnimals") return "동물 승리";
  if (endedWinner === "hunters") return "사냥꾼 승리";
  if (endedWinner === "animals") return "동물 승리";
  return "";
}

export default function Player() {
  const [loginId, setLoginId] = useState(localStorage.getItem("loginId") || "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");

  const [voteTarget, setVoteTarget] = useState("");
  const [voteReason, setVoteReason] = useState("");

  const phase = game?.status || "lobby";

  const isAlive = useMemo(() => {
    if (!me) return false;
    if (me.alive === "unknown") return true;
    return isTrue(me.alive);
  }, [me]);

  const isRevealed = useMemo(() => (me ? isTrue(me.roleRevealed) : false), [me]);

  const myAliveText = useMemo(() => {
    if (!me) return "";
    if (!phaseCanKnowAlive(phase)) return "알 수 없음";
    if (me.alive === "unknown") return "알 수 없음";
    return isTrue(me.alive) ? "생존" : "사망";
  }, [me, phase]);

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    (game?.players || []).forEach((p) => (m[p.playerId] = p.name));
    return m;
  }, [game]);

  const killedNames = useMemo(() => {
    if (!game) return [];
    return (game.revealed.killedPlayerIds || []).map((id) => nameById[id] || id);
  }, [game, nameById]);

  async function login() {
    try {
      setMsg("로그인 중...");
      const data = await callApi<{ token: string; me: Me; game: PublicGame }>({
        action: "playerLogin",
        loginId: loginId.trim(),
        password,
      });
      localStorage.setItem("loginId", loginId.trim());
      localStorage.setItem("token", data.token);
      setToken(data.token);
      setMe(data.me);
      setGame(data.game);
      setPassword("");
      setMsg(`접속 완료: ${data.me.name}`);
    } catch (e: any) {
      console.error(e);
      setMsg(`로그인 실패: ${String(e?.message || e)}`);
      alert(String(e?.message || e));
    }
  }

  async function refresh() {
    if (!token) return;
    const data = await callApi<{ me: Me; game: PublicGame }>({ action: "playerGetMe", token });
    setMe(data.me);
    setGame(data.game);
  }

  useEffect(() => {
    if (!token) return;
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const showRulebook = phase === "hike" || phase === "hikeEnd";
  const canAct = isAlive && !isRevealed;
  const canVote = isAlive && !isRevealed;

  const candidatesVote1 = useMemo(() => {
    if (!game || !me) return [];
    return game.players.filter((p) => {
      if (!isTrue(p.alive)) return false;
      if (isTrue(p.roleRevealed)) return false;
      if (p.playerId === me.playerId) return false;

      // ✅ 사냥꾼끼리 투표 금지(프론트 차단: knownOtherHunter 제외)
      if (me.role === "hunter" && me.knownOtherHunter && p.playerId === me.knownOtherHunter.playerId) return false;

      return true;
    });
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    const revealed = (game.vote1RevealedHunterId || "").trim();
    return game.players.filter((p) => {
      if (!isTrue(p.alive)) return false;
      if (isTrue(p.roleRevealed)) return false;
      if (p.playerId === me.playerId) return false;
      if (revealed && p.playerId === revealed) return false;

      // ✅ 사냥꾼끼리 투표 금지(프론트 차단)
      if (me.role === "hunter" && me.knownOtherHunter && p.playerId === me.knownOtherHunter.playerId) return false;

      return true;
    });
  }, [game, me]);

  async function submitHunt(targetId: string) {
    await callApi({ action: "playerSubmitHunt", token, targetId });
    alert("사냥 제출 완료");
    await refresh();
  }

  async function submitProtect(targetId: string) {
    await callApi({ action: "playerSubmitProtect", token, targetId });
    alert("보호 제출 완료");
    await refresh();
  }

  async function submitVote(round: 1 | 2) {
    const t = voteTarget.trim();
    const r = voteReason.trim();
    if (!t) return alert("투표 대상을 선택해 주세요.");
    if (!r) return alert("투표 사유를 입력해 주세요.");

    if (round === 1) {
      await callApi({ action: "playerSubmitVote1", token, targetId: t, reason: r });
      alert("1차 투표 제출 완료");
    } else {
      await callApi({ action: "playerSubmitVote2", token, targetId: t, reason: r });
      alert("2차 투표 제출 완료");
    }

    setVoteTarget("");
    setVoteReason("");
    await refresh();
  }

  const protectionAttempted = !!game?.revealed.protectionAttempted;
  const protectionResult = (game?.revealed.protectionResult || "none") as ProtectionResult;

  const winnerText = winnerLabelByPhaseOrField(phase, game?.endedWinner || "");

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h1>플레이어</h1>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>로그인</h2>
        <input placeholder="아이디" value={loginId} onChange={(e) => setLoginId(e.target.value)} style={{ width: 240 }} />
        <div style={{ height: 8 }} />
        <input
          placeholder="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: 240 }}
        />
        <div style={{ height: 10 }} />
        <button onClick={login} disabled={!loginId.trim() || !password}>
          로그인
        </button>
        <div style={{ marginTop: 8, color: "#555" }}>{msg}</div>

        {token && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
            <button
              onClick={() => {
                localStorage.removeItem("token");
                setToken("");
                setMe(null);
                setGame(null);
                setMsg("로그아웃됨");
              }}
            >
              로그아웃
            </button>
          </div>
        )}
      </section>

      {me && game && (
        <>
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <div>
              단계: <b>{phaseLabel(phase)}</b>
              {winnerText ? (
                <span>
                  {" "}
                  / 결과: <b>{winnerText}</b>
                </span>
              ) : null}
            </div>

            <div style={{ marginTop: 8 }}>
              내 이름: <b>{me.name}</b> / 생존: {myAliveText}
            </div>

            <div style={{ marginTop: 8 }}>
              내 역할: <b>{roleLabel(me.role)}</b>
              {isRevealed ? <span style={{ marginLeft: 8, color: "#b00" }}>(발각됨)</span> : null}
            </div>

            {me.role === "king" && me.knownHunter && (
              <div style={{ marginTop: 8 }}>
                내가 아는 사냥꾼 1명: <b>{me.knownHunter.name}</b>
              </div>
            )}

            {me.role === "hunter" && me.knownOtherHunter && (
              <div style={{ marginTop: 8 }}>
                다른 사냥꾼: <b>{me.knownOtherHunter.name}</b>
              </div>
            )}
          </section>

          {/* 종료 화면 */}
          {(phase === "endedHunters" || phase === "endedAnimals") && (
            <section style={{ border: "2px solid #222", padding: 12, marginBottom: 12 }}>
              <h2>최종결과 확인</h2>
              <div style={{ fontSize: 18 }}>
                결과: <b>{winnerText || "결과 처리 중"}</b>
              </div>
              <div style={{ marginTop: 8, color: "#555" }}>호스트 안내에 따라 마무리해 주세요.</div>
            </section>
          )}

          {/* 투표 안내 단계 */}
          {phase === "vote1Intro" && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
              <h2>1차투표 안내</h2>
              <div>- 생존자만 투표 가능</div>
              <div>- 사망/발각자는 투표 불가</div>
              <div>- 투표 사유는 필수</div>
              <div>- 2표 이상 받으면 사냥꾼 발각</div>
              <div style={{ marginTop: 8, color: "#555" }}>호스트가 투표를 열면 진행할 수 있어요.</div>
            </section>
          )}

          {phase === "vote2Intro" && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
              <h2>2차투표 안내</h2>
              <div style={{ marginBottom: 8 }}>
                발각된 사냥꾼: <b>{(game.revealedHunterNames || []).join(", ") || "없음"}</b>
              </div>
              <div>- 생존자만 투표 가능</div>
              <div>- 사망/발각자는 투표 불가</div>
              <div>- 투표 사유는 필수</div>
              <div>- 3표 이상 받으면 사냥꾼 발각</div>
              <div style={{ marginTop: 8, color: "#555" }}>호스트가 투표를 열면 진행할 수 있어요.</div>
            </section>
          )}

          {/* 룰북 */}
          {showRulebook && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
              <details open>
                <summary style={{ cursor: "pointer" }}>
                  <b>룰북 보기</b>
                </summary>
                <div style={{ marginTop: 10, lineHeight: 1.6 }}>
                  <div><b>등산 중</b></div>
                  <div>- 사냥꾼: 1회 비밀 사냥(본인/사냥꾼 제외 후보)</div>
                  <div>- 동물의 왕: 1회 비밀 보호(자기 포함 가능)</div>
                  <hr />
                  <div><b>투표</b></div>
                  <div>- 사망/발각자는 투표 불가</div>
                  <div>- 사냥꾼끼리는 서로 투표 불가</div>
                </div>
              </details>
            </section>
          )}

          {/* 공개 정보 */}
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <h2>공개 정보</h2>
            <div>사망자: {game.revealed.killedExists ? "있음" : "없음"}</div>
            {phaseCanKnowAlive(phase) && <div>사망자 목록: {killedNames.join(", ") || "없음"}</div>}
            <div>보호 시도: {protectionAttemptText(protectionAttempted)}</div>
            <div>보호 성공: {protectionResultText(protectionAttempted, protectionResult)}</div>
          </section>

          {/* 행동 */}
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <h2>행동</h2>

            {!canAct && phase !== "endedHunters" && phase !== "endedAnimals" && (
              <div>사망자 또는 발각된 사람은 행동/투표를 할 수 없어요.</div>
            )}

            {canAct && phase === "hike" && me.role === "hunter" && (
              <ActionSelect
                title="사냥(1회)"
                players={game.players.filter((p) => {
                  if (!isTrue(p.alive)) return false;
                  if (isTrue(p.roleRevealed)) return false;
                  if (p.playerId === me.playerId) return false;
                  if (me.knownOtherHunter && p.playerId === me.knownOtherHunter.playerId) return false;
                  return true;
                })}
                onSubmit={submitHunt}
                disabled={me.didHunt}
                disabledText="이미 사냥을 완료하였습니다."
              />
            )}

            {canAct && phase === "hike" && me.role === "king" && (
              <ActionSelect
                title="보호(1회, 자기 포함 가능)"
                players={game.players.filter((p) => {
                  if (!isTrue(p.alive)) return false;
                  if (isTrue(p.roleRevealed)) return false;
                  return true;
                })}
                onSubmit={submitProtect}
                disabled={me.didProtect}
                disabledText="이미 보호를 완료하였습니다."
              />
            )}

            {/* 투표 UI는 vote1 / vote2에서만 */}
            {canVote && phase === "vote1" && (
              <VoteBox
                title="1차 투표 (사유 필수)"
                candidates={candidatesVote1}
                target={voteTarget}
                reason={voteReason}
                setTarget={setVoteTarget}
                setReason={setVoteReason}
                onSubmit={() => submitVote(1)}
                disabled={me.didVote1}
                disabledText="이미 1차 투표를 제출했습니다."
              />
            )}

            {canVote && phase === "vote2" && (
              <VoteBox
                title="2차 투표 (사유 필수)"
                candidates={candidatesVote2}
                target={voteTarget}
                reason={voteReason}
                setTarget={setVoteTarget}
                setReason={setVoteReason}
                onSubmit={() => submitVote(2)}
                disabled={me.didVote2}
                disabledText="이미 2차 투표를 제출했습니다."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ActionSelect(props: {
  title: string;
  players: { playerId: string; name: string }[];
  onSubmit: (targetId: string) => Promise<void>;
  disabled?: boolean;
  disabledText?: string;
}) {
  const [target, setTarget] = useState("");
  return (
    <div style={{ border: "1px solid #eee", padding: 12, marginBottom: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <b>{props.title}</b>
      </div>

      <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={props.disabled}>
        <option value="">선택</option>
        {props.players.map((p) => (
          <option key={p.playerId} value={p.playerId}>
            {p.name}
          </option>
        ))}
      </select>

      <button onClick={() => props.onSubmit(target)} disabled={props.disabled || !target} style={{ marginLeft: 8 }}>
        제출
      </button>

      {props.disabled && props.disabledText ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>{props.disabledText}</div>
      ) : null}
    </div>
  );
}

function VoteBox(props: {
  title: string;
  candidates: { playerId: string; name: string }[];
  target: string;
  reason: string;
  setTarget: (v: string) => void;
  setReason: (v: string) => void;
  onSubmit: () => Promise<void>;
  disabled?: boolean;
  disabledText?: string;
}) {
  const canSubmit = props.target.trim() && props.reason.trim() && !props.disabled;

  return (
    <div style={{ border: "1px solid #eee", padding: 12, marginBottom: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <b>{props.title}</b>
      </div>

      <div style={{ marginBottom: 8 }}>
        <select value={props.target} onChange={(e) => props.setTarget(e.target.value)} disabled={props.disabled}>
          <option value="">대상 선택</option>
          {props.candidates.map((p) => (
            <option key={p.playerId} value={p.playerId}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <textarea
          placeholder="투표 사유(필수)"
          value={props.reason}
          onChange={(e) => props.setReason(e.target.value)}
          rows={4}
          style={{ width: "100%" }}
          disabled={props.disabled}
        />
      </div>

      <button onClick={props.onSubmit} disabled={!canSubmit}>
        제출
      </button>

      {props.disabled && props.disabledText ? (
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{props.disabledText}</div>
      ) : !props.reason.trim() ? (
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>사유를 입력해야 제출할 수 있어요.</div>
      ) : null}
    </div>
  );
}
