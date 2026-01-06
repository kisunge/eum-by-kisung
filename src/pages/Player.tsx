import { useEffect, useMemo, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any };
type ProtectionResult = "none" | "success" | "partial";

type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
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
  alive: any;
  roleRevealed: any;
  role: "king" | "hunter" | "animal";
  knownHunter: null | { playerId: string; name: string };
  otherHunter: null | { playerId: string; name: string };
};

const KAKAO_LINK = "http://qr.kakao.com/talk/uP76SnGIaCCpwgnfKQu0LTjQsvQ-";

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function roleKo(role: Me["role"]) {
  if (role === "king") return "동물의 왕";
  if (role === "hunter") return "동물의 탈을 쓴 사냥꾼";
  return "동물친구들";
}

function phaseKo(phase: string) {
  switch (phase) {
    case "lobby": return "대기";
    case "hike": return "등산시작";
    case "hikeEnd": return "등산종료";
    case "vote1Intro": return "1차투표(설명)";
    case "vote1": return "1차투표(진행)";
    case "vote2Intro": return "2차투표(설명)";
    case "vote2": return "2차투표(진행)";
    case "endedHunters": return "최종결과 확인";
    case "endedAnimals": return "최종결과 확인";
    default: return phase;
  }
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

export default function Player() {
  const [loginId, setLoginId] = useState(localStorage.getItem("loginId") || "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");

  // vote state
  const [voteTarget, setVoteTarget] = useState("");
  const [voteReason, setVoteReason] = useState("");

  const phase = game?.status || "lobby";

  // ✅ 생존 여부는 등산종료(hikeEnd) 이후부터만 공개
  const aliveVisible = phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended");
  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);

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

  const candidatesVote1 = useMemo(() => {
    if (!game || !me) return [];
    return game.players.filter((p) => {
      const isAlive = isTrue(p.alive);
      if (!isAlive) return false;
      if (p.playerId === me.playerId) return false;
      // 사망/발각자는 vote 대상 제외는 alive=false 처리로 해결
      // 사냥꾼끼리 투표 불가: UI에서도 제거
      if (me.role === "hunter" && me.otherHunter && p.playerId === me.otherHunter.playerId) return false;
      return true;
    });
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    return game.players.filter((p) => {
      const isAlive = isTrue(p.alive);
      if (!isAlive) return false;
      if (p.playerId === me.playerId) return false;
      if (me.role === "hunter" && me.otherHunter && p.playerId === me.otherHunter.playerId) return false;
      return true;
    });
  }, [game, me]);

  async function submitVote(round: 1 | 2) {
    const t = voteTarget.trim();
    const r = voteReason.trim();
    if (!t) return alert("투표 대상을 선택해 주세요.");
    if (!r) return alert("투표 사유를 입력해 주세요.");

    if (round === 1) {
      await callApi({ action: "playerSubmitVote1", token, targetId: t, reason: r });
    } else {
      await callApi({ action: "playerSubmitVote2", token, targetId: t, reason: r });
    }
    alert(`투표${round} 제출 완료`);
    setVoteTarget("");
    setVoteReason("");
    await refresh();
  }

  const showRulebook = phase === "hike" || phase === "hikeEnd";

  // 공개정보 표시 정책:
  // - 등산시작 이후에는 사망자: 있음/없음 표시(프리뷰)
  // - 등산종료 이후에는 사망자 목록(이름) 표시 (GAS가 killedPlayerIds 내려줌)
  const killedExistsText = game?.revealed.killedExists ? "있음" : "없음";
  const killedNames =
    (game?.revealed.killedPlayerIds || [])
      .map((id) => game?.players.find((p) => p.playerId === id)?.name || id)
      .join(", ") || "없음";

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h1>플레이어</h1>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>로그인</h2>
        <input
          placeholder="아이디"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          style={{ width: 240 }}
        />
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
              단계: <b>{phaseKo(phase)}</b>
              {game.endedWinner ? <span> / 승리: {game.endedWinner}</span> : null}
            </div>

            <div style={{ marginTop: 8 }}>
              내 이름: <b>{me.name}</b>
              {" / "}
              생존:{" "}
              <b>{aliveVisible ? (alive ? "생존" : "사망") : "비공개"}</b>
            </div>

            <div style={{ marginTop: 8 }}>
              내 역할: <b>{roleKo(me.role)}</b>
            </div>

            {me.role === "king" && me.knownHunter && (
              <div style={{ marginTop: 8 }}>
                내가 아는 사냥꾼 1명: <b>{me.knownHunter.name}</b>
              </div>
            )}

            {me.role === "hunter" && me.otherHunter && (
              <div style={{ marginTop: 8 }}>
                다른 사냥꾼: <b>{me.otherHunter.name}</b>
              </div>
            )}
          </section>

          {showRulebook && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
              <details open>
                <summary style={{ cursor: "pointer" }}>
                  <b>룰북 보기</b>
                </summary>
                <div style={{ marginTop: 10, lineHeight: 1.6 }}>
                  <div><b>목표</b></div>
                  <div>동물 진영: 사냥꾼 2명 모두 발각</div>
                  <div>사냥꾼: 끝까지 발각되지 않거나, 모두 발각 후 왕 지목 성공</div>
                  <hr />
                  <div><b>등산 중</b></div>
                  <div>- 사냥꾼: 1회 비밀 사냥</div>
                  <div>- 왕: 1회 비밀 보호(자기 포함 가능). 보호 대상은 사냥 무효</div>
                </div>
              </details>
            </section>
          )}

          {/* ✅ 변경된 행동 안내: 선택/제출 없음 */}
          {phase === "hike" && (me.role === "hunter" || me.role === "king") && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
              <h2>등산 중 비밀 행동 안내</h2>

              {me.role === "hunter" && (
                <div style={{ lineHeight: 1.7 }}>
                  <b>사냥꾼 행동</b>
                  <div>사냥할 동물의 <b>신발 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.</div>
                </div>
              )}

              {me.role === "king" && (
                <div style={{ lineHeight: 1.7 }}>
                  <b>동물의 왕 행동</b>
                  <div>보호할 동물의 <b>손 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.</div>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <a href={KAKAO_LINK} target="_blank" rel="noreferrer">
                  <button>진행자 카카오로 가기</button>
                </a>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                * 이 화면에서 선택/제출은 하지 않습니다. 진행자가 Host 화면에서 직접 처리합니다.
              </div>
            </section>
          )}

          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <h2>공개 정보</h2>

            <div>
              사망자:{" "}
              <b>
                {(phase === "hike" || phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended"))
                  ? killedExistsText
                  : "비공개"}
              </b>
            </div>

            {(phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")) && (
              <div style={{ marginTop: 6 }}>
                사망자 목록: <b>{killedNames}</b>
              </div>
            )}

            <div style={{ marginTop: 6 }}>
              보호 시도: <b>{protectionAttemptText(game.revealed.protectionAttempted)}</b>
            </div>

            <div style={{ marginTop: 6 }}>
              보호 성공: <b>{protectionResultText(game.revealed.protectionAttempted, game.revealed.protectionResult)}</b>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <h2>투표</h2>

            {/* ✅ 사망자는 투표 불가 (alive=false이면 숨김) */}
            {!aliveVisible ? (
              <div style={{ color: "#666" }}>등산종료 이후에 투표가 진행됩니다.</div>
            ) : !alive ? (
              <div>사망자는 투표를 할 수 없어요.</div>
            ) : (
              <>
                {phase === "vote1" && (
                  <VoteBox
                    title="1차 투표 (사유 필수)"
                    candidates={candidatesVote1}
                    target={voteTarget}
                    reason={voteReason}
                    setTarget={setVoteTarget}
                    setReason={setVoteReason}
                    onSubmit={() => submitVote(1)}
                  />
                )}

                {phase === "vote2" && (
                  <VoteBox
                    title="2차 투표 (사유 필수)"
                    candidates={candidatesVote2}
                    target={voteTarget}
                    reason={voteReason}
                    setTarget={setVoteTarget}
                    setReason={setVoteReason}
                    onSubmit={() => submitVote(2)}
                  />
                )}

                {(phase === "vote1Intro" || phase === "vote2Intro") && (
                  <div style={{ color: "#666", lineHeight: 1.6 }}>
                    진행자가 투표 규칙을 설명 중입니다. 곧 투표가 열리면 진행해주세요.
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
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
}) {
  const canSubmit = props.target.trim() && props.reason.trim();
  return (
    <div style={{ border: "1px solid #eee", padding: 12, marginBottom: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <b>{props.title}</b>
      </div>

      <div style={{ marginBottom: 8 }}>
        <select value={props.target} onChange={(e) => props.setTarget(e.target.value)}>
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
        />
      </div>

      <button onClick={props.onSubmit} disabled={!canSubmit}>
        제출
      </button>

      {!props.reason.trim() && (
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
          사유를 입력해야 제출할 수 있어요.
        </div>
      )}
    </div>
  );
}
