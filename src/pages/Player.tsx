import { useEffect, useMemo, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any };
type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
  revealed: { killedPlayerIds: string[]; protectionAttempted: any; protectionSucceeded: any };
  players: PublicPlayer[];
};

type Me = {
  playerId: string;
  name: string;
  alive: any;
  roleRevealed: any;
  role: "king" | "hunter" | "animal";
  knownHunter: null | { playerId: string; name: string };
  // (있다면) 사냥꾼끼리 서로 알기 표시용
  otherHunter?: null | { playerId: string; name: string };
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
    case "vote1Open": return "1차투표 안내";
    case "vote1": return "1차투표";
    case "vote2Open": return "2차투표 안내";
    case "vote2": return "2차투표";
    case "endedAnimals": return "최종결과 확인";
    case "endedHunters": return "최종결과 확인";
    default: return phase;
  }
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

  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);
  const phase = game?.status || "lobby";

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
      return isAlive && p.playerId !== me.playerId;
    });
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    const revealed = (game.vote1RevealedHunterId || "").trim();
    return game.players.filter((p) => {
      const isAlive = isTrue(p.alive);
      if (!isAlive) return false;
      if (p.playerId === me.playerId) return false;
      if (revealed && p.playerId === revealed) return false;
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

  // 공개정보: 배포 테스트 기준으로 간단 표기(원하면 더 다듬어드릴게요)
  const killedCount = (game?.revealed.killedPlayerIds || []).length;
  const killedText = phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")
    ? (killedCount ? "있음" : "없음")
    : "비공개";

  const protectionAttemptText = isTrue(game?.revealed.protectionAttempted) ? "시도함" : "시도 안함";
  const protectionSuccessText = String(game?.revealed.protectionSucceeded || "실패"); // (GAS에서 '성공/실패/일부 성공'으로 주는 방식이면 그대로 표시됨)

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
              {game.endedWinner ? <span> / 결과: {game.endedWinner}</span> : null}
            </div>

            <div style={{ marginTop: 8 }}>
              내 이름: <b>{me.name}</b> / 생존 여부:{" "}
              <b>{(phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")) ? (alive ? "생존" : "사망") : "비공개"}</b>
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
                  <div>- 왕: 1회 비밀 보호(보호 대상은 모든 사냥 무효)</div>
                </div>
              </details>
            </section>
          )}

          {/* ✅ 변경된 행동 안내 */}
          {phase === "hike" && alive && (me.role === "hunter" || me.role === "king") && (
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
            <div>사망자: <b>{killedText}</b></div>
            <div>보호 시도: <b>{protectionAttemptText}</b></div>
            <div>보호 성공: <b>{protectionSuccessText}</b></div>
          </section>

          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
            <h2>투표</h2>

            {!alive && <div>사망자는 투표를 할 수 없어요.</div>}

            {alive && phase === "vote1" && (
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

            {alive && phase === "vote2" && (
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
