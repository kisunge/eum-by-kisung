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
    killedPlayerNames: string[]; // (GAS에서 이름으로 내려주는 버전)
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
  knownHunter?: null | { playerId: string; name: string };
  otherHunter?: null | { playerId: string; name: string };
};

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function phaseLabelPlayer(phase: string) {
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

function roleLabel(role: Me["role"]) {
  switch (role) {
    case "king": return "동물의 왕";
    case "hunter": return "동물의 탈을 쓴 사냥꾼";
    case "animal": return "동물친구들";
    default: return role;
  }
}

export default function Player() {
  type UiStage = "splash" | "login" | "game";
  const [uiStage, setUiStage] = useState<UiStage>("splash");

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
  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);

  // ✅ GitHub Pages 하위 경로 대응 (BASE_URL)
  const splashUrl = `${import.meta.env.BASE_URL}ui/splash.png`;

  // ✅ START 버튼 히트박스 좌표 (페피님이 조정)
  const START_BTN = {
    left: "33%",   // ← 수정 포인트
    top: "77%",    // ← 수정 포인트
    width: "34%",  // ← 수정 포인트
    height: "10%", // ← 수정 포인트
  };

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

      setUiStage("game");
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

  // token이 있으면 새로고침해도 바로 game으로
  useEffect(() => {
    if (!token) return;
    setUiStage("game");
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const candidatesVote1 = useMemo(() => {
    if (!game || !me) return [];
    return game.players.filter((p) => isTrue(p.alive) && p.playerId !== me.playerId);
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    const revealed = (game.vote1RevealedHunterId || "").trim();
    return game.players.filter((p) => {
      if (!isTrue(p.alive)) return false;
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

  // ============================================================
  // SPLASH
  // ============================================================
  if (uiStage === "splash") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
        }}
      >
        <div style={{ position: "relative", width: "min(980px, 100%)" }}>
          <img
            src={splashUrl}
            alt="splash"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 14,
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            }}
          />

          {/* START 버튼 히트박스 */}
          <button
            onClick={() => setUiStage("login")}
            aria-label="START"
            style={{
              position: "absolute",
              left: START_BTN.left,
              top: START_BTN.top,
              width: START_BTN.width,
              height: START_BTN.height,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================
  // LOGIN POPUP (UI 디자인) + 뒤 배경 흐림
  // ============================================================
  if (uiStage === "login") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
        }}
      >
        <div style={{ position: "relative", width: "min(980px, 100%)" }}>
          {/* 배경 이미지 */}
          <img
            src={splashUrl}
            alt="splash"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 14,
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
              filter: "blur(3px) brightness(0.85)", // ✅ 흐림 + 살짝 어둡게
            }}
          />

          {/* 딤 오버레이 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(0,0,0,0.35)",
            }}
          />

          {/* 로그인 UI 팝업 */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(420px, 88%)",
              borderRadius: 18,
              background: "rgba(18,18,18,0.92)",
              border: "1px solid rgba(255,255,255,0.18)",
              boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
              padding: 16,
              color: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Login</div>
              <button
                onClick={() => setUiStage("splash")}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                Login ID
              </label>
              <input
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="Enter your ID"
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                Password
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter your password"
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            </div>

            <button
              onClick={login}
              disabled={!loginId.trim() || !password}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,200,60,0.95)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              LOGIN
            </button>

            {msg ? (
              <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.92)" }}>{msg}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME UI (기존 화면)
  // ============================================================
  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1>플레이어</h1>

      {!me || !game ? (
        <div style={{ color: "#555" }}>게임 정보를 불러오는 중...</div>
      ) : (
        <>
          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
            <div>
              단계: <b>{phaseLabelPlayer(phase)}</b>
              {game.endedWinner ? <span> / 승자: {game.endedWinner}</span> : null}
            </div>

            <div style={{ marginTop: 8 }}>
              내 이름: <b>{me.name}</b>
            </div>

            <div style={{ marginTop: 8 }}>
              생존:{" "}
              <b>
                {phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")
                  ? (alive ? "생존" : "사망")
                  : "알 수 없음"}
              </b>
            </div>

            <div style={{ marginTop: 8 }}>
              내 역할: <b>{roleLabel(me.role)}</b>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
            <h2>공개 정보</h2>
            <div>
              사망자:{" "}
              {phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")
                ? (game.revealed.killedPlayerNames.join(", ") || "없음")
                : (game.revealed.killedExists ? "있음" : "없음")}
            </div>
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

          <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12, borderRadius: 12 }}>
            <h2>투표</h2>

            {!alive && (phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")) && (
              <div>사망자는 투표할 수 없어요.</div>
            )}

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

            {(phase === "vote1Intro" || phase === "vote2Intro") && (
              <div style={{ color: "#555" }}>진행자가 투표 설명 중입니다. 잠시만 기다려주세요.</div>
            )}

            {(phase === "lobby" || phase === "hike" || phase === "hikeEnd") && (
              <div style={{ color: "#555" }}>현재 투표 단계가 아닙니다.</div>
            )}
          </section>

          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setMe(null);
              setGame(null);
              setMsg("");
              setUiStage("splash");
            }}
          >
            로그아웃
          </button>
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
          style={{ width: "100%" }}
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
