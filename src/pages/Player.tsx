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
    killedExists: boolean;              // "있음/없음" 표시에 사용
    killedPlayerIds: string[];          // 등산종료 이후 이름 표시용
    protectionAttempted: boolean;
    protectionResult: ProtectionResult; // none/success/partial
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
  knownOtherHunter?: null | { playerId: string; name: string }; // (있으면 표시)
};

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function phaseLabelPlayer(phase: string) {
  switch (phase) {
    case "lobby":
      return "대기";
    case "hike":
      return "등산시작";
    case "hikeEnd":
      return "등산종료";
    case "vote1Intro":
      return "1차투표(설명)";
    case "vote1":
      return "1차투표(진행)";
    case "vote2Intro":
      return "2차투표(설명)";
    case "vote2":
      return "2차투표(진행)";
    case "endedHunters":
      return "최종결과 확인(사냥꾼 승)";
    case "endedAnimals":
      return "최종결과 확인(동물 승)";
    default:
      return phase;
  }
}

function roleLabel(role: Me["role"]) {
  switch (role) {
    case "king":
      return "동물의 왕";
    case "hunter":
      return "동물의 탈을 쓴 사냥꾼";
    case "animal":
    default:
      return "동물친구들";
  }
}

// GitHub Pages 경로 안전하게 만드는 헬퍼
function assetUrl(pathFromPublic: string) {
  // 예: assetUrl("avatars/p1.png") -> /eum-by-kisung/avatars/p1.png
  return `${import.meta.env.BASE_URL}${pathFromPublic}`;
}

// 내 playerId 기반 프로필 아바타
function avatarByPlayerId(playerId: string) {
  // public/avatars/p1.png ... 이런 식으로 준비되어 있다고 가정
  return assetUrl(`avatars/${playerId}.png`);
}

export default function Player() {
  const [loginId, setLoginId] = useState(localStorage.getItem("loginId") || "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");

  // action/vote state
  const [voteTarget, setVoteTarget] = useState("");
  const [voteReason, setVoteReason] = useState("");

  const phase = game?.status || "lobby";
  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);

  // 등산종료 전에는 본인 생존여부를 숨김(요구사항)
  const showMyAlive = phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended");

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

  // 공개 정보: 등산종료 전엔 "사망자 있음/없음"만 표시, 등산종료 후에만 이름 공개
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    (game?.players || []).forEach((p) => (m[p.playerId] = p.name));
    return m;
  }, [game]);

  const killedNames = useMemo(() => {
    if (!game) return [];
    return (game.revealed.killedPlayerIds || [])
      .map((id) => nameById[id] || id)
      .filter(Boolean);
  }, [game, nameById]);

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h1>플레이어</h1>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
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
          {/* ✅ 프로필 영역: 캐릭터 아바타 사용 */}
          <section style={{ border: "1px solid #ddd", padding: 14, marginBottom: 12, borderRadius: 16 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 18,
                  border: "1px solid #ddd",
                  background: "linear-gradient(180deg, #f7f7f7, #ffffff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <img
                  src={avatarByPlayerId(me.playerId)}
                  alt={`${me.name} avatar`}
                  style={{ width: 92, height: 92, imageRendering: "pixelated" }}
                  onError={(e) => {
                    // 혹시 경로가 꼬이면 기본 이미지 없이 박스만 남게
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#666" }}>현재 단계</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{phaseLabelPlayer(phase)}</div>

                <div style={{ marginTop: 8, fontSize: 16 }}>
                  <b>{me.name}</b>
                </div>

                <div style={{ marginTop: 6, color: "#444" }}>
                  역할: <b>{roleLabel(me.role)}</b>
                </div>

                <div style={{ marginTop: 6, color: "#444" }}>
                  생존:{" "}
                  <b>
                    {showMyAlive ? (alive ? "생존" : "사망") : "등산 종료 후 공개"}
                  </b>
                </div>

                {/* 사냥꾼끼리 서로 아는 표시(데이터가 있으면 보여줌) */}
                {me.role === "hunter" && (me.knownHunter || me.knownOtherHunter) && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#666", lineHeight: 1.5 }}>
                    <div>
                      내가 아는 사냥꾼:{" "}
                      <b>{me.knownHunter?.name || me.knownOtherHunter?.name}</b>
                    </div>
                  </div>
                )}

                {me.role === "king" && me.knownHunter && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
                    내가 아는 사냥꾼 1명: <b>{me.knownHunter.name}</b>
                  </div>
                )}
              </div>
            </div>
          </section>

          {showRulebook && (
            <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
              <details open>
                <summary style={{ cursor: "pointer" }}>
                  <b>룰북 보기</b>
                </summary>
                <div style={{ marginTop: 10, lineHeight: 1.6 }}>
                  <div>
                    <b>목표</b>
                  </div>
                  <div>동물 진영: 사냥꾼 2명 모두 발각</div>
                  <div>사냥꾼: 끝까지 발각되지 않거나, 모두 발각 후 왕 지목 성공</div>
                  <hr />
                  <div>
                    <b>등산 중</b>
                  </div>
                  <div>- 사냥꾼: (카톡으로 진행자에게 사냥 증거 전달)</div>
                  <div>- 왕: (카톡으로 진행자에게 보호 증거 전달)</div>
                  <hr />
                  <div>
                    <b>정상 도착 후</b>
                  </div>
                  <div>- 사망자 공개</div>
                  <div>- 보호 시도/성공 여부 공개</div>
                </div>
              </details>
            </section>
          )}

          {/* 공개 정보 */}
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
            <h2>공개 정보</h2>

            {phase === "hike" ? (
              <div>사망자: {game.revealed.killedExists ? "있음" : "없음"}</div>
            ) : (
              <>
                <div>사망자: {killedNames.length ? killedNames.join(", ") : "없음"}</div>
              </>
            )}

            <div>보호 시도: {game.revealed.protectionAttempted ? "시도함" : "시도 안함"}</div>
            <div>
              보호 성공:{" "}
              {!game.revealed.protectionAttempted
                ? "해당 없음"
                : game.revealed.protectionResult === "success"
                ? "성공"
                : game.revealed.protectionResult === "partial"
                ? "일부 성공"
                : "실패"}
            </div>
          </section>

          {/* 행동/투표 영역 (현 구조 유지) */}
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
            <h2>행동</h2>

            {!alive && showMyAlive && <div>사망자는 행동/투표를 할 수 없어요.</div>}

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

            {/* 등산 단계에서는 안내만 보이도록(요구사항 반영되어 있다면 phase별 안내만) */}
            {phase === "hike" && (
              <div style={{ color: "#666", lineHeight: 1.6 }}>
                {me.role === "hunter" ? (
                  <>
                    <div>사냥할 동물의 <b>신발 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.</div>
                    <a
                      href="http://qr.kakao.com/talk/uP76SnGIaCCpwgnfKQu0LTjQsvQ-"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        padding: "10px 12px",
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        textDecoration: "none",
                      }}
                    >
                      진행자 카카오로 가기
                    </a>
                  </>
                ) : me.role === "king" ? (
                  <>
                    <div>보호할 동물의 <b>손 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.</div>
                    <a
                      href="http://qr.kakao.com/talk/uP76SnGIaCCpwgnfKQu0LTjQsvQ-"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        padding: "10px 12px",
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        textDecoration: "none",
                      }}
                    >
                      진행자 카카오로 가기
                    </a>
                  </>
                ) : (
                  <div>등산 중에는 자유롭게 이동/대화하며 추리를 진행하세요.</div>
                )}
              </div>
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
    <div style={{ border: "1px solid #eee", padding: 12, marginBottom: 12, borderRadius: 12 }}>
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
          style={{ width: "100%", borderRadius: 10, border: "1px solid #ddd", padding: 10 }}
        />
      </div>

      <button onClick={props.onSubmit} disabled={!canSubmit}>
        제출
      </button>
      {!props.reason.trim() && (
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>사유를 입력해야 제출할 수 있어요.</div>
      )}
    </div>
  );
}
